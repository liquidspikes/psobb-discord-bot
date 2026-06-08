// =====================================================================
// PRIVILEGE TIERS
// Two tiers sit above a normal community member:
//   • admin   — holders of the Discord Administrator permission. Full access,
//               including destructive commands (!clear, !pull, !restart, token
//               mint/revoke/give).
//   • support — holders of a configured "support" role (default "Community
//               Support"). May run read-only / support commands (!sync all,
//               !roles, !channels, !log, !health, !interactions check) but NOT
//               the destructive ones.
// resolveMember() lets a DM-invoked command still find the caller's server roles
// via role_sync.guild_id, so !help (and tier checks) work outside the guild.
// =====================================================================
const { config } = require('./config');

// Role names/ids (case-insensitive) that grant the support tier. Configurable via
// role_sync.support_roles; defaults to "Community Support".
const SUPPORT_ROLES = new Set(
    (((config.role_sync || {}).support_roles) || ['Community Support']).map((r) => String(r).toLowerCase())
);

function isAdmin(member) {
    return !!(member && member.permissions && member.permissions.has('Administrator'));
}

function isSupport(member) {
    if (!member || !member.roles) return false;
    return member.roles.cache.some(
        (r) => SUPPORT_ROLES.has(r.id) || SUPPORT_ROLES.has(r.name.toLowerCase())
    );
}

// Gate for read-only / support commands: admins OR support-role holders.
function canSupport(member) {
    return isAdmin(member) || isSupport(member);
}

function memberTier(member) {
    if (isAdmin(member)) return 'admin';
    if (isSupport(member)) return 'support';
    return 'member';
}

// Resolve the caller's GuildMember even when a command arrives via DM (message.member
// is null there). Falls back to fetching the member from the configured guild so tier
// checks and !help work in DMs. Returns null when it can't be resolved.
async function resolveMember(message) {
    if (message.member) return message.member;
    try {
        const guildId = (config.role_sync || {}).guild_id;
        if (!guildId) return null;
        const { client } = require('./discordClient');
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return null;
        return await guild.members.fetch(message.author.id).catch(() => null);
    } catch (e) {
        return null;
    }
}

module.exports = { SUPPORT_ROLES, isAdmin, isSupport, canSupport, memberTier, resolveMember };
