// The shared Discord.js client instance, imported by every module that needs it.
const { Client, Partials } = require('discord.js');

const client = new Client({
    intents: 3276799,
    partials: Object.values(Partials).filter((x) => typeof x === 'number'),
});

module.exports = { client };
