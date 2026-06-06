const fs = require('fs');
const axios = require('axios');

const config = JSON.parse(fs.readFileSync('/psobb-bot/discord_config.json', 'utf8'));

async function testApi() {
    try {
        let url = config.psobb_api_url + "&action=get_online_players";
        const resp = await axios.get(url, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 5000
        });
        console.log("Online Players Data:", JSON.stringify(resp.data).substring(0, 500));
        
        let url2 = config.psobb_api_url + "&action=get_events";
        const resp2 = await axios.get(url2, {
            headers: { 'Authorization': "Bearer " + config.psobb_api_secret },
            timeout: 5000
        });
        console.log("Events Data:", JSON.stringify(resp2.data).substring(0, 500));
    } catch(e) {
        console.error(e.message);
    }
}

testApi();
