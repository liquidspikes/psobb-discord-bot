const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const { MEMORY_DIR } = require('./config');
const { logInfo, logError } = require('./actionLog');

const PREFS_PATH = path.join(MEMORY_DIR, 'user_notifications.json');

// Map of userId -> { DM: boolean, LFG: boolean, VC: boolean }
let prefs = {};

function load() {
    try {
        if (fs.existsSync(PREFS_PATH)) {
            const obj = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
            if (obj && typeof obj === 'object') {
                prefs = obj;
                return;
            }
        }
    } catch (e) {
        logError('NOTIFY', `Load error: ${e.message}`);
    }
    prefs = {};
}

function save() {
    try {
        fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
    } catch (e) {
        logError('NOTIFY', `Save error: ${e.message}`);
    }
}

// Load on start
load();

function getPrefs(userId) {
    const userPrefs = prefs[String(userId)] || {};
    return {
        DM: !!userPrefs.DM,
        LFG: !!userPrefs.LFG,
        VC: !!userPrefs.VC,
    };
}

function setPref(userId, type, value) {
    const u = String(userId);
    if (!prefs[u]) prefs[u] = {};
    
    const t = String(type).toUpperCase();
    if (t === 'DM') prefs[u].DM = !!value;
    else if (t === 'LFG') prefs[u].LFG = !!value;
    else if (t === 'VC') prefs[u].VC = !!value;
    else return false;
    
    save();
    return true;
}

/**
 * Sends a DM to a user/member, automatically adding MessageFlags.SuppressNotifications
 * if the user has not enabled push notifications for the specified type (default 'DM').
 */
async function sendDM(userOrMember, contentOrOptions, type = 'DM') {
    const user = userOrMember.user || userOrMember;
    const userPrefs = getPrefs(user.id);
    const enabled = userPrefs[type.toUpperCase()];
    
    let options = typeof contentOrOptions === 'string' ? { content: contentOrOptions } : { ...contentOrOptions };
    
    if (!options.flags) {
        options.flags = [];
    } else if (!Array.isArray(options.flags)) {
        options.flags = [options.flags];
    }
    
    if (!enabled) {
        if (!options.flags.includes(MessageFlags.SuppressNotifications)) {
            options.flags.push(MessageFlags.SuppressNotifications);
        }
    }
    
    return await user.send(options);
}

module.exports = {
    getPrefs,
    setPref,
    sendDM,
    prefs // expose raw dict for iteration
};
