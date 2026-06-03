// Diagnostic: dump the raw get_player API response for one Discord ID so we can see
// how many character slots the server actually returns (and each slot's index).
// Usage:  node diag_get_player.js <discord_id>
const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));
const discordId = process.argv[2];

if (!discordId) {
    console.error('Usage: node diag_get_player.js <discord_id>');
    process.exit(1);
}

async function run() {
    try {
        const url = config.psobb_api_url + "&action=get_player&discord_id=" + encodeURIComponent(discordId);
        const resp = await axios.get(url, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 8000
        });
        const data = resp.data || {};

        console.log('=== TOP-LEVEL KEYS ===');
        console.log(Object.keys(data).join(', '));

        const chars = data.Characters || data.characters || [];
        console.log(`\n=== CHARACTERS: ${chars.length} returned ===`);
        chars.forEach((c, i) => {
            const slot = c.slot ?? c.Slot ?? c.slot_id ?? c.SlotID ?? c.slot_index ?? '(no slot field)';
            const name = c.name || c.Name || c.character_name || c.CharacterName || '(no name)';
            const level = c.level || c.Level || '?';
            const klass = c.class || c.Class || c.className || c.ClassName || '?';
            console.log(`  [arr ${i}] slot=${slot}  name="${name}"  Lvl ${level}  ${klass}`);
        });

        console.log('\n=== PER-CHARACTER KEYS (first char) ===');
        if (chars[0]) console.log(Object.keys(chars[0]).join(', '));

        console.log('\n=== FULL RAW (truncated to 4000 chars) ===');
        console.log(JSON.stringify(data, null, 2).substring(0, 4000));
    } catch (e) {
        console.error('Request failed:', e.message);
    }
}

run();
