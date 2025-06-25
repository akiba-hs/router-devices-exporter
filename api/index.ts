import express from 'express';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { Gauge, register } from 'prom-client';
import dotenv from 'dotenv';
import axiosRetry from 'axios-retry';

dotenv.config();

const ROUTER_URL = process.env.ROUTER_URL ?? (() => { throw new Error('ROUTER_URL environment variable must be set!') })();
const ROUTER_USER = process.env.ROUTER_USER ?? (() => { throw new Error('ROUTER_USER environment variable must be set!') })();
const ROUTER_PASS = process.env.ROUTER_PASS ?? (() => { throw new Error('ROUTER_PASS environment variable must be set!') })();

const PORT = 3000;

const deviceConnDuration = new Gauge({
    name: 'router_device_connection_duration_seconds',
    help: 'Сколько секунд устройство находится подключенным (только для активных устройств)',
    labelNames: ['mac', 'hostName'] as const,
});

async function collectMetrics() {
    register.resetMetrics();
    axiosRetry(axios, { retries: 15, retryDelay: axiosRetry.linearDelay(), retryCondition: () => true });
    const { data: xml } = await axios.get<string>(ROUTER_URL, { auth: { username: ROUTER_USER, password: ROUTER_PASS } });
    const result = await parseStringPromise(xml, { explicitArray: false });
    const devices = Array.isArray(result.deviceList.device)
        ? result.deviceList.device
        : [result.deviceList.device];

    for (const d of devices) {
        const alive = Number(d.alive);
        if (alive !== 1) continue;

        const mac = d.mac as string;
        const hostName = (d.hostName as string) || 'unknown';

        const [lastRawStr] = (d.lastSeeTime as string).split('|');
        const [activeRawStr] = (d.activeTime as string).split('|');
        const lastRaw = Number(lastRawStr);
        const activeRaw = Number(activeRawStr);

        const connDuration = lastRaw - activeRaw;
        const duration = connDuration >= 0 ? connDuration : 0;

        deviceConnDuration.set({ mac, hostName }, duration);
    }
}

const app = express();
app.get('/metrics', async (_req, res) => {
    try {
        await collectMetrics();
        res.set('Content-Type', register.contentType);
        res.send(await register.metrics());
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Error');
    }
});

app.listen(PORT, () => {
    console.log(`Started: http://127.0.0.1:${PORT}/metrics`);
});

module.exports = app;
