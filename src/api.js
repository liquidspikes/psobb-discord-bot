// PSOBB server API + drops-data access (with a 30-minute drops cache).
const axios = require('axios');
const { config } = require('./config');

// Drops Cache Variables & Helper
let cachedDrops = null;
let lastDropsFetch = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function getDropsData() {
    const now = Date.now();
    if (cachedDrops && (now - lastDropsFetch < CACHE_DURATION)) {
        return cachedDrops;
    }
    console.log("[DROPS] Fetching fresh drop data from server...");
    const url = "https://psobb.io/api/get_drops.php";
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp.data && resp.data.success && resp.data.data) {
        cachedDrops = resp.data.data;
        lastDropsFetch = now;
        return cachedDrops;
    }
    if (cachedDrops) {
        console.warn("[DROPS] Fetch failed, using expired cache");
        return cachedDrops;
    }
    throw new Error("Failed to load drop data from server");
}

async function apiCall(action, params = {}) {
    try {
        let url = config.psobb_api_url + "&action=" + action;
        for (const [key, val] of Object.entries(params)) {
            if (val) url += `&${key}=${encodeURIComponent(val)}`;
        }
        const resp = await axios.get(url, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 5000
        });
        return resp.data;
    } catch (e) {
        console.error(`[API ERROR] ${action}: ${e.message}`);
        return { error: "Service unavailable" };
    }
}

module.exports = { apiCall, getDropsData };
