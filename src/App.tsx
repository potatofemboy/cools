import React, { useState, useEffect, useRef, useMemo } from 'react';

const DATA_URL =
  'https://api.github.com/repos/potatofemboy/discord-data/contents/data.json';

const BOT_INVITE_URL =
  'https://discord.com/oauth2/authorize?client_id=1473979364222701700&permissions=8&integration_type=0&scope=bot';
const SUPPORT_URL = 'https://discord.gg/ynatEnRKWV';

const LAUNCH_DATE = new Date(2026, 2, 1);
const UPTIME_START = new Date(2026, 1, 20);

const DAYS_LIVE = Math.max(
  1,
  Math.ceil((Date.now() - LAUNCH_DATE.getTime()) / 86400000)
); 
const DAYS_MONITORED = Math.max(
  1,
  Math.ceil((Date.now() - UPTIME_START.getTime()) / 86400000)
);

interface Cmd {
  name: string;
  args: string;
  desc: string;
  perm: 'Owner' | 'Manager' | 'Admin' | 'Server Owner';
}

interface CommandGroupData {
  icon: string;
  color: string;
  cmds: Cmd[];
}

interface DowntimeEntry {
  id: number;
  server_went_down_approx: string;
  bot_came_back_up?: string;
  duration_seconds: number;
  duration_human: string;
  reason: string;
}

interface Heartbeat {
  last_seen: string;
}

interface BackupEntry {
  thread_name: string;
  timestamp_str: string;
  timestamp_iso: string | null;
  size_kb: number | null;
  encrypted: boolean;
}

interface GuildInfo {
  id: string;
  name: string;
  member_count: number;
  owner_id: string;
  channel_count: number;
  role_count: number;
  boost_level: number;
  boost_count: number;
  icon_url: string | null;
  created_at: string;
  description: string;
}

interface UserInfo {
  id: string;
  name: string;
  display_name: string;
  avatar_url: string | null;
}

interface LiveData {
  downtime_log: DowntimeEntry[];
  heartbeat: Heartbeat;
  maintenance: boolean;
  ping_ms?: number;
  // real access-control & backup registry fields from data.json
  admins?: string[];
  managers?: string[];
  backup_owners?: Record<string, string>;
  backup_shared_access?: Record<string, string[]>;
  backup_whitelist_guilds?: string[];
  backup_whitelist_users?: string[];
  backup_blocked_guilds?: string[];
  backup_blocked_users?: string[];
  // live snapshots written by _dashboard_sync_loop
  guild_snapshot?: Record<string, GuildInfo>;
  user_cache?: Record<string, UserInfo>;
  backup_inventory?: Record<string, BackupEntry[]>; // server_id -> list of backups
  autobackup_schedules?: Record<string, {
    interval_hours: number;
    last_run_ts: number;
    notify_channel_id?: number;
    ch_bl?: string[];
    save_mb?: boolean;
    fmt_v?: number;
    encrypt_password?: string | null;
  }>;
}

interface StatItem {
  label: string;
  value: number;
  suffix: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  tag: string;
  color: string;
  changes: string[];
}

interface FaqEntry {
  q: string;
  a: string;
}

const PERM_COLORS: Record<string, string> = {
  Owner: '#ED4245',
  Manager: '#EB459E',
  Admin: '#FEE75C',
  'Server Owner': '#5865F2',
};
const COMMANDS: Record<string, CommandGroupData> = {
  'Backup & Restore': {
    icon: '💾',
    color: '#5865F2',
    cmds: [
      {
        name: 'save',
        args: '<server_id> [id2 ...]',
        desc: 'Back up one or more servers. Saves roles, channels, categories, emojis, stickers, bans, members, webhooks, automod rules, scheduled events, welcome screen, soundboard, and threads.',
        perm: 'Server Owner',
      },
      {
        name: 'save all',
        args: '',
        desc: 'Refresh backups for every server that already has at least one backup. Servers with no prior backup are skipped. Prompts once for shared options then runs all saves in parallel.',
        perm: 'Owner',
      },
      {
        name: 'clone',
        args: '<src_id> <tgt_id>',
        desc: 'Copy a live server\'s structure (roles, channels, categories) directly onto another server without saving a file first.',
        perm: 'Manager',
      },
      {
        name: 'load',
        args: '<src_id> <tgt_id>',
        desc: 'Restore a backup onto a target server. If the source has multiple backups the bot lists them and waits for you to pick one.',
        perm: 'Server Owner',
      },
      {
        name: 'backups',
        args: '<server_id>',
        desc: 'List all stored backups for a server, showing backup number, timestamp, and file size.',
        perm: 'Owner',
      },
      {
        name: 'delbackup',
        args: '<server_id> <backup_number>',
        desc: 'Delete a specific backup. Use #$backups to see backup numbers (1 = oldest).',
        perm: 'Owner',
      },
      {
        name: 'autobackup',
        args: '<server_id> <hours>',
        desc: 'Schedule automatic backups on a clock-aligned repeating interval (e.g. every 3h fires at 3am, 6am, 9am… UTC). Walks you through the same interactive setup as #$save: channel blacklist, member data, format, encryption, and message capture. Multiple schedules share clock slots — a 1h and 3h will both fire at 3am, 6am, etc. Also supports: autobackup list, autobackup cancel <server_id>.',
        perm: 'Manager',
      },
      {
        name: 'verifybackup',
        args: '<server_id> [backup_number]',
        desc: 'Download and verify a backup can be fully decompressed and parsed. Reports role, channel, and member counts. Defaults to the most recent backup.',
        perm: 'Owner',
      },
      {
        name: 'diff',
        args: '<server_id> <n1> <n2>',
        desc: 'Compare two backups side by side, showing added/removed/renamed roles, channels, and member count changes.',
        perm: 'Owner',
      },
      {
        name: 'sharebackup',
        args: '<server_id> <user_id>',
        desc: 'Grant a user shared access to a server\'s backups. They can restore it with #$load but cannot delete or modify it.',
        perm: 'Server Owner',
      },
      {
        name: 'unsharebackup',
        args: '<server_id> <user_id>',
        desc: 'Revoke a user\'s shared access to a server\'s backups.',
        perm: 'Server Owner',
      },
      {
        name: 'sharedwith',
        args: '<server_id>',
        desc: 'List all users who currently have shared access to a server\'s backups.',
        perm: 'Owner',
      },
    ],
  },
  'Server Info': {
    icon: '📊',
    color: '#ED4245',
    cmds: [
      {
        name: 'info',
        args: '<server_id>',
        desc: 'Show live server stats: name, ID, owner, member count, channels, roles, boost level, verification level, and creation date.',
        perm: 'Admin',
      },
    ],
  },
  'Access Control': {
    icon: '🔑',
    color: '#FEE75C',
    cmds: [
      {
        name: 'addadmin',
        args: '<user_id>',
        desc: 'Grant a user admin-level bot access. Admins can use a subset of commands but not destructive owner-only ones. Persists across restarts.',
        perm: 'Owner',
      },
      {
        name: 'removeadmin',
        args: '<user_id>',
        desc: 'Revoke admin access from a user.',
        perm: 'Owner',
      },
      {
        name: 'viewadmins',
        args: '',
        desc: 'List all current managers and admins, showing their user ID and tag.',
        perm: 'Admin',
      },
      {
        name: 'setadminrole',
        args: '<guild_id> <role_id>',
        desc: 'Designate a Discord role as the auto-admin role. Anyone in that guild with that role is automatically granted admin bot access.',
        perm: 'Owner',
      },
      {
        name: 'viewroles',
        args: '<user_id>',
        desc: 'List all roles a user currently has across every server the bot shares with them.',
        perm: 'Admin',
      },
      {
        name: 'allowserver',
        args: '<server_id>',
        desc: 'Whitelist a server, waiving the 20-member requirement for backup commands. Also removes from blocklist if present.',
        perm: 'Owner',
      },
      {
        name: 'blockserver',
        args: '<server_id>',
        desc: 'Block a server from all backup operations. Also removes from whitelist if present.',
        perm: 'Owner',
      },
      {
        name: 'allowuser',
        args: '<user_id>',
        desc: 'Whitelist a user, waiving the 20-member requirement for their servers. Also removes from blocklist if present.',
        perm: 'Owner',
      },
      {
        name: 'blockuser',
        args: '<user_id>',
        desc: 'Block a user from all backup operations. Also removes from whitelist if present.',
        perm: 'Owner',
      },
      {
        name: 'viewaccess',
        args: '',
        desc: 'View all whitelisted and blocked servers and users across the backup access registry.',
        perm: 'Owner',
      },
    ],
  },
  'Bot Control': {
    icon: '🤖',
    color: '#EB459E',
    cmds: [
      {
        name: 'end',
        args: '',
        desc: 'Gracefully shut the bot down. Records a clean exit so no downtime is logged on next start.',
        perm: 'Owner',
      },
      {
        name: 'restart',
        args: '',
        desc: 'Restart the bot process. Records a clean exit before restarting. Admins require a confirmation prompt first.',
        perm: 'Admin',
      },
    ],
  },
};

const STATS: StatItem[] = [
  { label: 'Days Live', value: DAYS_LIVE, suffix: '' },
  { label: 'Lines Of Code', value: 11000, suffix: '+' },
  { label: 'Commands', value: 20, suffix: '+' },
  { label: 'Backups Stored', value: 50, suffix: '+' },
  { label: 'Helper Bots', value: 5, suffix: '' },
];

const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v1.1.5',
    date: 'Mar 7, 2026',
    tag: 'minor',
    color: '#FF7043',
    changes: [
      'Autobackup now walks through the same interactive setup as #$save (channel blacklist, member data, format, encryption, message capture)',
      'Autobackup schedules are now clock-aligned to UTC midnight — a 1h and 3h schedule both fire at 3am, 6am, 9am etc.',
      'Autobackup no longer fires immediately on setup — always waits for the next clock slot (minimum 60s)',
      'Autobackup now posts a start/finish notification to the channel where it was configured, matching the #$save UI',
      'Autobackup permission raised to Manager+ (was accessible to Admins previously)',
      'Admin panel backups tab now shows all active autobackup schedules with interval, next run countdown, format, and member settings',
      'Deleting a backup now immediately updates the admin panel without waiting for the next sync',
      'Fixed UnboundLocalError crash in on_message caused by a bare import datetime inside the massmute branch shadowing the module-level import',
    ],
  },
  {
    version: 'v1.1.4',
    date: 'Mar 7, 2026',
    tag: 'minor',
    color: '#00BCD4',
    changes: [
      'Status page services are now expandable; each shows its own uptime %, day-bar chart, and incident history',
      'Fixed offline false positive: bot is now only marked offline if heartbeat is over 5 minutes old',
      'Added Check Again button to status page for instant manual refresh',
      'Fixed --green CSS variable circular reference in dark mode affecting pulse dots and uptime colors',
      'Fixed uptime % card borders not showing in dark mode',
      'Admin panel backup registry now scans the actual storage forum threads instead of relying on backup_owners',
      'Admin panel server sort controls: most/least members, newest/oldest, A-Z, backed up first',
    ],
  },
  {
    version: 'v1.1.3',
    date: 'Mar 6, 2026',
    tag: 'minor',
    color: '#FFB300',
    changes: [
      'Added #$diff: compare any two backups side by side with a color-coded change report',
      'Added optional AES-256 encryption on save (#$save → Step 5/6), use --password flag on load/verify to decrypt',
      'Added #$sharebackup / #$unsharebackup to grant or revoke backup access to other users per server',
      'Added #$sharedwith: list all users who have shared access to a server\'s backups',
      'Added password-protected admin panel tab',
    ],
  },
  {
    version: 'v1.1.2',
    date: 'Mar 6, 2026',
    tag: 'minor',
    color: '#5865F2',
    changes: [
      'Added dark/light mode toggle, persisted across sessions',
      'Added Try It tab with animated multi-turn command previews',
      'Status page now shows live bot ping/latency next to Main Bot',
      'FAQ tab now has a search bar that filters by question and answer',
      'Save command now DMs the initiator a per-server summary on completion',
      'Backups list now shows days remaining before each backup expires (⚠️ under 5 days)',
      'Added daily background loop that DMs backup owners when a backup expires within 5 days',
      'verifybackup now appends a live vs backup diff when the bot is still in the server',
      'Rate limit message now shows a Discord countdown and auto-deletes when the cooldown expires',
    ],
  },
  {
    version: 'v1.1.1',
    date: 'Mar 6, 2026',
    tag: 'patch',
    color: 'var(--green)',
    changes: [
      'Fixed backup commands being incorrectly restricted to Owner only, they now correctly allow any Discord server owner with bot access',
      'Admins and Managers can now use save, load, backups, delbackup, autobackup, and verifybackup for servers they personally own',
      'Added ownership guard to autobackup cancel so non-owners can only cancel schedules for their own servers',
    ],
  },
  {
    version: 'v1.1.0',
    date: 'Mar 6, 2026',
    tag: 'dashboard',
    color: '#9C27B0',
    changes: [
      'Added invite button and support server button to the header',
      'Added unverified bot notice linking to the support server',
      'Added Terms of Service and Privacy Policy tabs',
      'Added permission level badge to every command showing the minimum required role',
      'Fixed command permissions across the board to match the actual bot code',
      'Fixed command args and descriptions to match real bot behavior',
      'Added toast notification when copying a command',
      'Added / hotkey to focus the command search bar',
      'Added scroll-to-top button that appears after scrolling down',
      'Added footer with invite link and support server',
      'Added meta tags and og:tags so the site embeds properly in Discord',
      'Fixed memory leak in stat counter animations',
      'Fixed uptime percentage calculation for incidents crossing window boundaries',
      'Fixed FAQ accordion clipping on long answers',
      'Stats grid now stacks correctly on smaller screens',
    ],
  },
  {
    version: 'v1.0.2',
    date: 'Mar 6, 2026',
    tag: 'patch',
    color: '#FF5252',
    changes: [
      'Fixed a memory leak in the stat counter animations on the dashboard',
      'Uptime percentage now correctly handles incidents that cross window boundaries',
      'Version badge in the header now pulls from the changelog automatically',
      'FAQ answers no longer get clipped if the content is too tall',
      'Clipboard copy now handles permission errors without silently failing',
      'Stats grid now stacks properly on smaller screens',
    ],
  },
  {
    version: 'v1.0.1',
    date: 'Mar 1, 2026',
    tag: 'release',
    color: '#26C6DA',
    changes: [
      'Public release, bot opened to server owners',
      'Server owner self-service backups (20+ member requirement)',
      'Auto-leave with support server invite for under-20 servers',
      'Server and user whitelist/blocklist for fine-grained access control',
      'Backup ownership tracking, owners can only load their own backups',
    ],
  },
  {
    version: 'v1.0.0',
    date: 'Feb 20, 2026',
    tag: 'initial build',
    color: '#69F0AE',
    changes: [
      'Initial build: backup, restore, clone, and autobackup system',
      'Downtime detector with heartbeat pulse and clean shutdown tracking',
      '5 parallel helper bot instances for rate-limit bypass on restores',
      'Manager role with save permissions above standard Admin',
      'Live server stats monitor and status cycling',
    ],
  },
];

const FAQ: FaqEntry[] = [
  { q: 'Who can back up a server?', a: 'Server owners with 20 or more members can run #$save on their own server. If your server is whitelisted by the bot owner, the member count requirement is waived.' },
  { q: 'My server has under 20 members, can I still get a backup?', a: 'Not automatically. The bot will send you an invite to our support server when it leaves, and you can request a manual backup there: discord.gg/ynatEnRKWV' },
  { q: 'How do I create a backup?', a: 'Run #$save <server_id> in DMs with the bot. It will walk you through options for channel blacklist, member data, format, encryption, and message capture.' },
  { q: 'How do I find my server ID?', a: 'Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode), then right-click your server icon and click "Copy Server ID".' },
  { q: 'The bot left my server. What happened?', a: 'The bot only joins servers temporarily to perform a backup or restore, then leaves. This is intentional. You interact with it via DMs, not through a server bot.' },
  { q: 'How do I invite the bot?', a: 'Click the Invite Bot button at the top of this page. The bot will join your server, perform the requested operation, and leave automatically.' },
  { q: 'Does the bot stay in my server permanently?', a: 'No. The bot joins temporarily to perform a backup or restore, then leaves on its own. It does not remain as a permanent member.' },
  { q: 'Do I need any special permissions to use the bot?', a: 'You need to be the server owner. Standard admins and moderators of a server cannot use backup commands unless the bot owner grants them admin or manager access.' },
  { q: 'Can I use the bot from inside my server?', a: 'No. All commands are sent to the bot via DMs. The bot does not respond to commands typed inside servers.' },
  { q: 'What prefix does the bot use?', a: 'All commands start with #$. For example: #$save, #$load, #$backups.' },
  { q: 'Does the bot work with any Discord server?', a: 'Yes, as long as your server has 20 or more members. Servers under 20 members require manual whitelisting by the bot owner.' },
  { q: 'How do I know if my backup was successful?', a: 'The bot will send you a confirmation message with the backup details after #$save completes. You can also run #$verifybackup to confirm the file is intact.' },
  { q: 'Can I use the bot on multiple servers?', a: 'Yes. You can run #$save <server_id> for each server you own. Each server gets its own backup storage.' },
  { q: 'Is there a guide or documentation?', a: 'Yes. Check the Commands tab on this website for a full list of commands and the Try It tab for interactive examples.' },
  { q: 'How do I contact support?', a: 'Join the support server at discord.gg/ynatEnRKWV and open a ticket.' },
  { q: 'What does a backup include?', a: 'Roles, channels, categories, emojis, stickers, bans, members, webhooks, automod rules, scheduled events, welcome screen, soundboard, threads, and optionally message history.' },
  { q: 'What is NOT included in a backup?', a: 'Message history is opt-in and not saved by default. Boost status, nitro perks, and third-party integrations (like bots) are not included.' },
  { q: 'How are backups stored?', a: 'Backups are compressed and stored securely. Multiple backups per server are kept, but are automatically deleted after 30 days. Use #$delbackup to clean up old ones manually.' },
  { q: 'How many backups can I store per server?', a: 'There is no hard limit on the number of backups, but all backups are automatically deleted after 30 days. Use #$backups to see what you have and #$delbackup to clean up manually.' },
  { q: 'How do I view my backups?', a: 'Run #$backups <server_id> to list all stored backups for a server, showing backup number, timestamp, and file size.' },
  { q: 'How do I delete a backup?', a: 'Run #$delbackup <server_id> <backup_number>. Use #$backups to find the backup number first (1 = oldest).' },
  { q: 'Can I verify a backup is intact before restoring?', a: 'Yes. Run #$verifybackup <server_id> to download and fully decompress the backup and report role, channel, and member counts. Defaults to the most recent backup.' },
  { q: 'Does the bot save message history by default?', a: 'No. Message history is opt-in. During the #$save flow the bot will ask whether you want to capture messages and which channels to include.' },
  { q: 'How do I compare two backups?', a: 'Run #$diff <server_id> <n1> <n2> to compare two backups side by side, showing added/removed/renamed roles, channels, and member count changes.' },
  { q: 'Can I encrypt my backups?', a: 'Yes. During the #$save setup flow you will be prompted to optionally set an encryption password. You will need to provide it again when restoring.' },
  { q: 'How long do backups stay before being deleted?', a: '30 days. All backups are automatically purged after 30 days. Use #$backups to check ages and #$delbackup to remove ones you no longer need.' },
  { q: 'Can I back up multiple servers at once?', a: 'Yes. Run #$save <id1> <id2> <id3> with multiple server IDs in one command to queue them all.' },
  { q: 'What file format are backups saved in?', a: 'Backups are compressed archives. The format is chosen during the #$save setup flow.' },
  { q: 'Can I download my backup file?', a: 'Backup files are stored on our servers and are not directly downloadable. Use #$verifybackup to confirm integrity.' },
  { q: 'What does the backup number mean?', a: 'Backup #1 is always the oldest. Each new backup increments the number. Use #$backups <server_id> to see the list with numbers.' },
  { q: 'Can I blacklist channels from being backed up?', a: 'Yes. During the #$save setup flow the bot will ask which channels to exclude from the backup.' },
  { q: 'Does the backup include banned users?', a: 'Yes. Ban lists are included in the backup by default.' },
  { q: 'Does the backup include server emojis and stickers?', a: 'Yes. Custom emojis and stickers are included in the backup.' },
  { q: 'Does the backup save role permissions?', a: 'Yes. All role names, colors, permissions, and hierarchy positions are saved.' },
  { q: 'Does the backup include webhooks?', a: 'Yes. Webhooks are included in the backup.' },
  { q: 'Does the backup include automod rules?', a: 'Yes. AutoMod rules and configurations are saved as part of the backup.' },
  { q: 'Does the backup include scheduled events?', a: 'Yes. Scheduled events are saved in the backup.' },
  { q: 'Does the backup include the welcome screen?', a: 'Yes. The server welcome screen configuration is included.' },
  { q: 'Does the backup include soundboard sounds?', a: 'Yes. Soundboard sounds are included in the backup.' },
  { q: 'Does the backup include threads?', a: 'Yes. Thread channels and their configurations are included.' },
  { q: 'Does the backup include member nicknames?', a: 'Yes, if member data is enabled during the #$save setup flow.' },
  { q: 'Does the backup include member roles?', a: 'Yes, if member data is enabled during the #$save setup flow, role assignments per member are saved.' },
  { q: 'How big are backup files typically?', a: 'Size varies by server. Small servers are a few KB. Large servers with thousands of members and message history can be several MB.' },
  { q: 'What happens to my backups if I stop using the bot?', a: 'They will be automatically deleted after 30 days as normal. There is no special action required.' },
  { q: 'How do I restore a backup?', a: 'Run #$load <src_id> <tgt_id>. If the server has multiple backups the bot will list them and wait for you to pick one. The bot will confirm before wiping and rebuilding.' },
  { q: 'Does restoring a backup wipe my current server?', a: 'Yes. The restore process deletes existing channels and roles before rebuilding from the backup. Make sure you want to fully overwrite the target server before running #$load.' },
  { q: 'Can I restore onto a server with fewer than 20 members?', a: 'Yes, the 20-member limit only applies when creating a new backup. Loading an existing backup has no member count requirement, as long as it is your own server.' },
  { q: 'Can I load someone else\'s backup?', a: 'No. You can only load backups registered to your own server. The bot tracks backup ownership and will reject any attempt to load a backup you did not create. You can however be granted shared access via #$sharebackup.' },
  { q: 'Can I restore a backup onto a different server than it was taken from?', a: 'Yes. #$load <src_id> <tgt_id> lets you restore a backup from any server you own onto any other server you own.' },
  { q: 'What happens if the bot goes offline mid-restore?', a: 'The restore may be incomplete. Re-run #$load once the bot is back online. Use #$verifybackup first to confirm the backup file is intact.' },
  { q: 'How long does a restore take?', a: 'Depends on server size. Small servers finish in under a minute. Large servers with hundreds of channels and thousands of members can take several minutes. The bot uses 5 helper instances in parallel to speed up the process.' },
  { q: 'Will restoring re-invite my old members?', a: 'No. Member data such as nicknames and role assignments is restored, but the bot cannot re-invite members who left the server.' },
  { q: 'Will restoring re-add my old bots?', a: 'No. Third-party bots are not included in the backup. You will need to re-invite them manually.' },
  { q: 'Can I do a partial restore, like only channels?', a: 'No. The restore is all-or-nothing. It rebuilds the full server structure from the backup.' },
  { q: 'What happens to my current channels during a restore?', a: 'They are deleted before the backup is applied. Make sure you are ready to lose all current server content.' },
  { q: 'Can I restore a backup to a brand new empty server?', a: 'Yes. Create a new Discord server, then run #$load <src_id> <new_server_id> to restore onto it.' },
  { q: 'Will my server\'s boost level be restored?', a: 'No. Boost status depends on members actively boosting and cannot be restored by the bot.' },
  { q: 'Will the restored server have the same invite links?', a: 'No. Discord invite links are not included in backups and will need to be recreated after a restore.' },
  { q: 'How do I pick which backup to restore if I have multiple?', a: 'When you run #$load, the bot will list all available backups with numbers and timestamps and ask you to pick one by replying with the number.' },
  { q: 'Can I restore an encrypted backup?', a: 'Yes. Run #$load as normal and the bot will prompt you to provide the encryption password before restoring.' },
  { q: 'What if I forgot my backup encryption password?', a: 'Unfortunately encrypted backups cannot be decrypted without the password. There is no recovery option. Keep your password safe.' },
  { q: 'Does restoring keep the server\'s existing bans?', a: 'No. Existing bans are removed and replaced with the bans from the backup.' },
  { q: 'Does restoring restore channel topic descriptions?', a: 'Yes. Channel names, topics, and permission overwrites are all restored.' },
  { q: 'How do I set up automatic backups?', a: 'Run #$autobackup <server_id> <hours> to schedule backups on a repeating interval. It walks you through the same setup as #$save (channel blacklist, members, format, encryption, messages).' },
  { q: 'Can I cancel or change my autobackup schedule?', a: 'Yes. Run #$autobackup cancel <server_id> to remove a schedule, or run #$autobackup <server_id> <hours> again to reconfigure it. Schedules survive bot restarts.' },
  { q: 'How do autobackup intervals work?', a: 'All schedules are clock-aligned to UTC midnight. A 3h schedule fires at 12am, 3am, 6am, 9am, etc. A 1h and 3h schedule will both fire together at those shared slots.' },
  { q: 'Can I see a list of my active autobackup schedules?', a: 'Yes. Run #$autobackup list to see all active schedules, their intervals, last run time, and notify channel.' },
  { q: 'What is the minimum autobackup interval?', a: '1 hour. You can schedule backups as frequently as every hour.' },
  { q: 'Can I get notified when an autobackup completes?', a: 'Yes. During the autobackup setup the bot will ask if you want a notification and which channel to post it in.' },
  { q: 'Do autobackup schedules survive bot restarts?', a: 'Yes. All autobackup schedules are persisted and resume automatically after any restart or downtime.' },
  { q: 'Can I have multiple autobackup schedules for different servers?', a: 'Yes. Each server has its own independent autobackup schedule. Run #$autobackup for each server separately.' },
  { q: 'What happens if an autobackup fails?', a: 'The bot will log the error and try again at the next scheduled interval. Check #$autobackup list to see the last run time.' },
  { q: 'Can I set autobackup to run daily?', a: 'Yes. Run #$autobackup <server_id> 24 to schedule a backup every 24 hours.' },
  { q: 'Can I set autobackup to run weekly?', a: 'Yes. Run #$autobackup <server_id> 168 to schedule a backup every 7 days (168 hours).' },
  { q: 'Who can set up autobackup?', a: 'Manager+ access is required to set up autobackup schedules.' },
  { q: 'Will autobackup overwrite old backups?', a: 'No. Each autobackup run creates a new backup entry. Old entries are kept until they expire after 30 days or are manually deleted.' },
  { q: 'Can I share my backup with someone else?', a: 'Yes. Run #$sharebackup <server_id> <user_id> to grant a user shared access. They can restore it with #$load but cannot delete or modify it.' },
  { q: 'How do I revoke shared access?', a: 'Run #$unsharebackup <server_id> <user_id> to remove a user\'s shared access.' },
  { q: 'How do I see who has shared access to my backup?', a: 'Run #$sharedwith <server_id> to list all users who currently have shared access.' },
  { q: 'Can someone with shared access delete my backups?', a: 'No. Shared access only allows restoring. They cannot delete, modify, or re-share your backups.' },
  { q: 'Can I share a backup with multiple people?', a: 'Yes. Run #$sharebackup for each user you want to grant access to. There is no limit on how many users can have shared access.' },
  { q: 'Does shared access expire?', a: 'No. Shared access persists until you revoke it with #$unsharebackup.' },
  { q: 'Can a shared user see all my backups or just one?', a: 'Shared access is per server. Granting someone access to a server\'s backup gives them access to all backups for that specific server.' },
  { q: 'What can a shared user do with my backup?', a: 'They can run #$load to restore the backup onto a server they own. They cannot view backup contents, delete, or modify them.' },
  { q: 'What\'s the difference between Manager and Admin?', a: 'Manager is above Admin. Managers can trigger autobackups and have all Admin permissions. Admins handle access control and server info commands but cannot create or restore backups.' },
  { q: 'How do I add an admin?', a: 'Run #$addadmin <user_id> to grant a user admin-level bot access. This persists across restarts.' },
  { q: 'How do I remove an admin?', a: 'Run #$removeadmin <user_id> to revoke admin access from a user.' },
  { q: 'How do I view current admins and managers?', a: 'Run #$viewadmins to list all current managers and admins with their user IDs.' },
  { q: 'Can I assign a Discord role as an auto-admin?', a: 'Yes. Run #$setadminrole <guild_id> <role_id>. Anyone in that guild with that role is automatically granted admin bot access.' },
  { q: 'Can I view what roles a user has?', a: 'Yes. Run #$viewroles <user_id> to list all roles a user has across every server the bot shares with them.' },
  { q: 'How do I whitelist a server to bypass the 20-member limit?', a: 'The bot owner runs #$allowserver <server_id>. This waives the member count requirement and removes the server from the blocklist if present.' },
  { q: 'How do I block a server from using the bot?', a: 'The bot owner runs #$blockserver <server_id>. This prevents all backup operations for that server.' },
  { q: 'How do I whitelist a user to bypass the 20-member limit?', a: 'The bot owner runs #$allowuser <user_id>. This waives the member count requirement for all their servers.' },
  { q: 'How do I block a user from using the bot?', a: 'The bot owner runs #$blockuser <user_id>. This blocks them from all backup operations.' },
  { q: 'How do I view all whitelisted and blocked servers/users?', a: 'Run #$viewaccess to see the full access registry including all whitelists and blocklists.' },
  { q: 'Do admin permissions persist after the bot restarts?', a: 'Yes. All admin and manager assignments are saved and persist across restarts.' },
  { q: 'Can an admin use backup commands?', a: 'No. Backup commands (save, load, delbackup, etc.) require server owner level. Admins handle access control and server info only.' },
  { q: 'Can a manager use backup commands?', a: 'Managers can use autobackup and clone. Full backup/restore commands are server-owner level.' },
  { q: 'I got blocked, what do I do?', a: 'Join the support server at discord.gg/ynatEnRKWV and open a ticket explaining the situation. Include your user ID and server ID.' },
  { q: 'My server got blocked even though I didn\'t do anything wrong.', a: 'Blocks can sometimes be issued in error. Join discord.gg/ynatEnRKWV and open a ticket with your server ID and a brief explanation.' },
  { q: 'Can the bot owner whitelist my server to bypass the 20-member limit?', a: 'Yes. The bot owner can run #$allowserver <server_id> to waive the 20-member requirement. Request this in the support server.' },
  { q: 'Why was my server blocked?', a: 'Servers are typically blocked for abuse, spam, or violating usage rules. Join discord.gg/ynatEnRKWV and open a ticket to find out and appeal.' },
  { q: 'Why was my account blocked?', a: 'Accounts are blocked for abuse, attempting to access other users\' backups, or other violations. Open a ticket at discord.gg/ynatEnRKWV to appeal.' },
  { q: 'Can I get unblocked?', a: 'Yes, if the block was in error or you can demonstrate the issue has been resolved. Open a ticket at discord.gg/ynatEnRKWV.' },
  { q: 'I was blocked but I did not abuse the bot.', a: 'Open a ticket in the support server at discord.gg/ynatEnRKWV with your user/server ID and explain the situation. Blocks can be reversed.' },
  { q: 'What counts as abuse of the bot?', a: 'Attempting to access backups you do not own, spamming commands, using the bot for malicious purposes, or intentionally causing issues for other users.' },
  { q: 'What are the helper bots?', a: 'The bot runs 5 parallel helper bot instances. During a restore, roles and channels are created across all instances simultaneously to work around Discord\'s rate limits and speed up large restores.' },
  { q: 'Why does the bot need to join my server?', a: 'The bot needs to be in your server temporarily to read its structure during a backup, or to create channels/roles during a restore. It leaves automatically when done.' },
  { q: 'Is there a way to clone a server directly without saving a file?', a: 'Yes. Run #$clone <src_id> <tgt_id> to copy a live server\'s structure directly onto another server without creating a backup file. Manager+ only.' },
  { q: 'How do I check if the bot is online?', a: 'Check the Status tab on this website. It shows live uptime, last ping time, and days without downtime.' },
  { q: 'What happens if the bot goes offline mid-backup?', a: 'The backup file may be incomplete. Once the bot is back online, re-run #$save and use #$verifybackup to confirm the new backup is valid.' },
  { q: 'Does the bot store my server data permanently?', a: 'No. Backups are automatically deleted after 30 days unless you delete them earlier with #$delbackup.' },
  { q: 'Does the bot log my commands?', a: 'Errors are logged for debugging purposes. Normal command usage is not permanently logged.' },
  { q: 'Is the bot open source?', a: 'No. The bot is privately maintained. For questions about how it works, ask in the support server.' },
  { q: 'What Discord permissions does the bot need?', a: 'The bot requires Administrator permissions to read and recreate all server structures accurately during backup and restore.' },
  { q: 'What happens if Discord\'s API rate limits the bot mid-backup?', a: 'The bot handles rate limits automatically and will slow down or pause until limits reset. Your backup will still complete.' },
  { q: 'What happens if Discord\'s API rate limits the bot mid-restore?', a: 'The bot uses 5 helper instances to spread the load across rate limit buckets. If a limit is hit it waits and retries automatically.' },
  { q: 'Can the bot back up a server it is not currently in?', a: 'No. The bot must join the server temporarily to read its structure. It will join, back up, then leave.' },
  { q: 'How does the bot handle very large servers?', a: 'Large servers take longer but the bot is designed to handle them. It uses parallel helper instances and processes roles, channels, and members in batches.' },
  { q: 'Does the bot support servers with threads and forums?', a: 'Yes. Thread channels and forum posts are included in backups.' },
  { q: 'Does the bot support Stage channels?', a: 'Yes. Stage channels are included in the backup.' },
  { q: 'Does the bot support Voice channels?', a: 'Yes. Voice channels and their permission overwrites are backed up and restored.' },
  { q: 'What Discord server features are preserved in a backup?', a: 'Roles, channels (text, voice, forum, stage, announcement), categories, emojis, stickers, bans, members, webhooks, automod rules, scheduled events, welcome screen, soundboard, and threads.' },
  { q: 'Does the bot work with community servers?', a: 'Yes. Community servers are fully supported including announcement channels, welcome screens, and rules channels.' },
  { q: 'Can the bot restore a backup to a server in a different region?', a: 'Yes. Server region is not a factor in backup or restore operations.' },
  { q: 'Does the bot preserve channel order?', a: 'Yes. Channels and categories are restored in the same order as they were in the original server.' },
  { q: 'Does the bot preserve role hierarchy?', a: 'Yes. Role positions and hierarchy are saved and restored.' },
  { q: 'Does the bot preserve role colors?', a: 'Yes. Role colors are included in the backup.' },
  { q: 'Does the bot preserve channel permission overwrites?', a: 'Yes. Per-channel role and user permission overwrites are included in the backup.' },
  { q: 'What is #$info used for?', a: 'Run #$info <server_id> to get live server stats: name, ID, owner, member count, channels, roles, boost level, verification level, and creation date.' },
  { q: 'What is #$whois used for?', a: 'Run #$whois <user_id> to look up a user\'s profile across all servers the bot shares with them.' },
  { q: 'What does #$stats show?', a: 'It shows bot statistics like total servers, total backups, uptime, and system resource usage.' },
  { q: 'What does #$uptime show?', a: 'It shows how long the bot has been running since its last restart.' },
  { q: 'What does #$downs show?', a: 'It shows the bot\'s downtime history and recent outage events.' },
  { q: 'How does #$pingcheck work?', a: 'It checks the bot\'s connection latency to Discord\'s API and reports the result.' },
  { q: 'The bot says my server has under 20 members but it does not.', a: 'Make sure you are using the correct server ID. If you believe this is an error, open a ticket in the support server.' },
  { q: 'The bot is not responding to my DMs.', a: 'Make sure you have DMs enabled from server members in your Discord privacy settings. Also confirm the bot is online via the Status tab.' },
  { q: 'The backup command says \'guild not found\'.', a: 'Make sure the server ID is correct and the bot is currently in or able to join that server. Check the server ID using Discord\'s Developer Mode.' },
  { q: 'The restore says \'guild not found\' for the target server.', a: 'Make sure the target server ID is correct and the bot can join it. The bot must be able to access the target server to restore onto it.' },
  { q: 'I ran #$save but nothing happened.', a: 'Check that you are DMing the bot and not sending the message in a server. Also confirm the bot is online via the Status tab.' },
  { q: 'The bot said my backup was successful but #$backups shows nothing.', a: 'The backup list updates after a short delay. Wait a minute and run #$backups again. If it still shows nothing, open a support ticket.' },
  { q: 'I got an \'encryption password required\' error during restore.', a: 'Your backup was saved with an encryption password. Provide it when prompted during #$load. If you forgot it, the backup cannot be recovered.' },
  { q: 'The restore seems to have stopped halfway.', a: 'The bot may have hit a rate limit or encountered a Discord API error. Wait a few minutes and re-run #$load. Use #$verifybackup beforehand.' },
  { q: 'Why did the bot kick itself from my server after backing up?', a: 'This is intentional. The bot leaves after completing its task. You do not need to kick it.' },
  { q: 'The bot says \'backup not found\' when I try to restore.', a: 'Make sure the backup number is correct. Run #$backups <server_id> to see the list. Remember: 1 is oldest, the highest number is newest.' },
  { q: 'The bot says I do not own this backup.', a: 'Backups are tied to the server owner who created them. If you are not the original owner or have not been granted shared access, you cannot load it.' },
  { q: 'The bot says the command failed. What should I do?', a: 'Note the error message and open a support ticket at discord.gg/ynatEnRKWV with your user ID, server ID, and the exact error.' },
  { q: 'The bot joined my server but did not do anything.', a: 'This could be a rate limit or permission issue. Make sure the bot has Administrator permissions. If the issue persists open a support ticket.' },
  { q: 'Can I retry a failed backup?', a: 'Yes. Simply run #$save again. Failed backups do not count against your stored backups.' },
  { q: 'Can I retry a failed restore?', a: 'Yes. Run #$load again. Run #$verifybackup first to confirm the backup file is valid.' },
  { q: 'The autobackup did not run at the expected time.', a: 'Autobackup schedules are clock-aligned to UTC midnight. Check the exact schedule with #$autobackup list. Slight delays of a few minutes are normal.' },
  { q: 'The bot is slow to respond.', a: 'The bot may be under heavy load or experiencing rate limits. Check the Status tab for any reported issues.' },
  { q: 'I accidentally deleted all my channels and roles. Can the bot recover them?', a: 'Only if you have a backup. Run #$load to restore from your most recent backup. This is exactly why regular backups are recommended.' },
  { q: 'The bot says \'no backups found\' for a server I definitely backed up.', a: 'Backups expire after 30 days. If it has been more than 30 days since your last backup it may have been automatically deleted.' },
  { q: 'Is it safe to give the bot Administrator permissions?', a: 'The bot needs Administrator to read and rebuild your full server structure. It only uses permissions during the backup/restore operation and leaves afterward.' },
  { q: 'Can the bot read my messages?', a: 'The bot can read messages if you opt into message history capture during the #$save flow. It does not read messages otherwise.' },
  { q: 'Who has access to my backup data?', a: 'Only you (the server owner) and anyone you explicitly grant shared access to via #$sharebackup.' },
  { q: 'Is my backup data encrypted in transit?', a: 'Yes. All communication with Discord\'s API uses HTTPS. Backup files can additionally be encrypted with a password you set during #$save.' },
  { q: 'Can the bot owner see my backup contents?', a: 'Technically the bot owner has access to the underlying storage. For sensitive servers we recommend using the encryption option during #$save.' },
  { q: 'How do I request deletion of my data?', a: 'Open a ticket in the support server at discord.gg/ynatEnRKWV. Backups are also auto-deleted after 30 days.' },
  { q: 'Does the bot collect any personal information?', a: 'The bot stores server structure data (roles, channels, members) as part of the backup. No personal data beyond what is part of your Discord server is collected.' },
  { q: 'Is the bot compliant with Discord\'s Terms of Service?', a: 'Yes. The bot operates within Discord\'s API guidelines and ToS.' },
  { q: 'Is the bot free?', a: 'Yes, completely free. No subscriptions, no paywalls, no premium tiers.' },
  { q: 'Will the bot ever become paid?', a: 'There are no current plans to charge for the bot. If that ever changes, existing users will be notified.' },
  { q: 'How do I report a bug?', a: 'Open a ticket in the support server at discord.gg/ynatEnRKWV with a description of the issue, your user ID, and the server ID if relevant.' },
  { q: 'How do I suggest a feature?', a: 'Open a ticket or post in the suggestions channel in the support server at discord.gg/ynatEnRKWV.' },
  { q: 'Is there a changelog?', a: 'Yes. Check the Changelog tab on this website for a full history of updates.' },
  { q: 'How often is the bot updated?', a: 'Updates are released as needed. Check the Changelog tab for the latest changes.' },
  { q: 'Can I self-host this bot?', a: 'No. The bot is not publicly available for self-hosting.' },
  { q: 'Does the bot support slash commands?', a: 'No. The bot uses the #$ prefix for all commands, sent via DMs.' },
  { q: 'Can I use the bot from a phone?', a: 'Yes. You can DM the bot and run commands from the Discord mobile app just like on desktop.' },
  { q: 'What should I do if I think someone is abusing the bot?', a: 'Report it by opening a ticket in the support server at discord.gg/ynatEnRKWV with relevant details.' },
  { q: 'Does the bot have an uptime guarantee?', a: 'No formal SLA, but the bot is monitored and downtime is typically resolved quickly. Check the Status tab for history.' },
  { q: 'How do I see the bot\'s current status?', a: 'Check the Status tab on this website. It shows real-time online/offline status, uptime %, and recent downtime events.' },
  { q: 'What is the support server?', a: 'It is the official Discord server for this bot where you can get help, report issues, and request features: discord.gg/ynatEnRKWV' },
  { q: 'Can I DM the bot directly?', a: 'Yes. All commands are sent to the bot via DMs. Find it by its username and start a conversation.' },
  { q: 'What happens if I leave the support server?', a: 'Nothing happens to your backups or account. The support server is just for getting help.' },
  { q: 'Does the bot have rate limits?', a: 'Yes. The bot enforces internal rate limits to prevent abuse and stay within Discord\'s API limits. Repeated spam of commands may temporarily slow your requests.' },
  { q: 'Can multiple people from the same server use the bot?', a: 'Only the server owner can use backup/restore commands. Other users can be granted admin or manager access for limited commands.' },
  { q: 'Is there a limit on how many servers I can back up?', a: 'No hard limit. You can back up as many servers as you own.' },
  { q: 'What is #$export used for?', a: 'It exports various data in a readable format. Check #$help export for specifics.' },
  { q: 'What is #$alert used for?', a: 'It sends an alert message to all bot admins. Used by the bot owner to broadcast important notices.' },
  { q: 'What is #$announce used for?', a: 'Manager+ only. Sends an announcement to a specified server channel via the bot.' },
  { q: 'What is #$monitor used for?', a: 'Manager+ only. Monitors a server for changes and logs them. Use #$unmonitor to stop.' },
  { q: 'What is #$notes used for?', a: 'Allows storing and retrieving notes tied to a server or user ID. Useful for admin record-keeping.' },
  { q: 'What is #$disconnect used for?', a: 'Forces the bot to disconnect from a server it may be stuck in. Admin+ only.' },
  { q: 'What is #$move used for?', a: 'Moves a target user between voice channels. Admin+ only.' },
  { q: 'Does the bot support two-factor authentication servers?', a: 'Yes. The bot works with 2FA-required servers as long as the bot account itself meets Discord\'s 2FA requirements for moderation actions.' },
  { q: 'Can the bot restore onto a server I just created?', a: 'Yes. Create a fresh server and run #$load <src_id> <new_id> to restore a backup onto it.' },
  { q: 'Will a restore remove the default @everyone role?', a: 'No. The @everyone role always exists on Discord servers and cannot be deleted. Its permissions will be updated to match the backup.' },
  { q: 'Does the bot send any messages to my server during backup?', a: 'No. The bot joins, performs the backup silently, and leaves. No messages are posted in your server channels.' },
  { q: 'Does the bot send any messages to my server during restore?', a: 'No. The bot performs the restore silently. No messages are posted in channels during the process.' },
  { q: 'Can I back up a server that I am not the owner of?', a: 'No. You must be the registered owner of the server. Being an admin or moderator is not sufficient.' },
  { q: 'Does the backup preserve the server name and icon?', a: 'Yes. Server name and icon are included in the backup and restored.' },
  { q: 'Does the backup preserve the server description?', a: 'Yes. The server description is included in the backup.' },
  { q: 'Does the backup preserve verification level settings?', a: 'Yes. Server verification level, explicit content filter, and other moderation settings are backed up.' },
  { q: 'Does the backup preserve the AFK channel setting?', a: 'Yes. The AFK channel and timeout settings are included in the backup.' },
  { q: 'Does the backup preserve system channel settings?', a: 'Yes. System channel configuration including boost and join messages are included.' },
  { q: 'Can I restore a backup to a server in a different Discord data region?', a: 'Yes. Server regions do not affect backup or restore operations.' },
  { q: 'How do I know which backup number to restore?', a: 'Run #$backups <server_id> to see a list with numbers and timestamps. Backup #1 is the oldest and the highest number is the most recent.' },
  { q: 'What is the difference between #$save and #$saveall?', a: '#$save backs up specific server IDs you provide. #$save all runs a fresh backup for every server that already has at least one existing backup.' },
  { q: 'Can I use the bot if the bot owner is offline?', a: 'Yes. The bot runs independently. You do not need the bot owner to be online to use backup commands.' },
  { q: 'Does the bot need to stay in my server after a backup?', a: 'No. The bot leaves automatically after completing the backup. There is no need to manually kick it.' },
  { q: 'What happens if I kick the bot while it is backing up?', a: 'The backup will likely be interrupted and incomplete. Do not kick the bot while an operation is in progress.' },
  { q: 'What happens if I kick the bot while it is restoring?', a: 'The restore will be interrupted and your server may be left in a partial state. Do not kick the bot mid-restore.' },
  { q: 'Can I back up a server that has NSFW channels?', a: 'Yes. NSFW channel configurations are backed up and restored. Channel content (messages) is only included if you opt into message history.' },
  { q: 'Can I back up a server with community features enabled?', a: 'Yes. Community servers are fully supported.' },
  { q: 'Can I back up a private server?', a: 'Yes. As long as you are the server owner the bot can be invited to join and back it up regardless of whether the server is public or private.' },
  { q: 'What is the #$restart command?', a: 'Restarts the bot process. Owner or admin with confirmation. Records a clean exit before restarting.' },
  { q: 'What is the #$end command?', a: 'Gracefully shuts the bot down. Owner only. Records a clean exit so no downtime is logged on next start.' },
  { q: 'Can I back up a server to use as a template?', a: 'Yes. Back up your template server and then use #$load to restore it onto a new server whenever you need a fresh copy.' },
  { q: 'How do I use the bot to migrate a server?', a: 'Back up the source server with #$save, create a new server, then restore with #$load <src_id> <new_server_id>.' },
  { q: 'Does the bot support backing up servers with hundreds of channels?', a: 'Yes. The bot handles large servers with many channels. Backups and restores may take longer for very large servers.' },
  { q: 'Does the bot support backing up servers with thousands of members?', a: 'Yes. Member data is included if you enable it during the #$save flow. Very large member lists may add time to the backup.' },
  { q: 'Can I store backups of the same server from different points in time?', a: 'Yes. Every time you run #$save a new backup entry is created. Old backups are kept for 30 days alongside newer ones.' },
  { q: 'Does the bot notify me when a backup expires?', a: 'No. There is no expiry notification. Monitor your backups with #$backups and run #$save regularly to keep fresh copies.' },
  { q: 'Can I set the bot to notify me when a backup is about to expire?', a: 'Not currently. This is a potential future feature. For now, use #$autobackup to keep backups fresh automatically.' },
  { q: 'How do I back up a server right now without any prompts?', a: 'Currently #$save always walks through the setup flow. There is no one-command silent backup. The setup typically takes under a minute.' },
  { q: 'Can I use the bot on a server I manage but do not own?', a: 'No. Only the registered server owner can use backup commands. You would need the owner to run the commands or grant you manager/admin access.' },
  { q: 'What is the difference between #$blockserver and #$blockuser?', a: '#$blockserver blocks a specific server from all backup operations. #$blockuser blocks a specific user account from all backup operations across all their servers.' },
  { q: 'What is the difference between #$allowserver and #$allowuser?', a: '#$allowserver whitelists a server to bypass the 20-member minimum. #$allowuser whitelists a user so the 20-member minimum is waived for all their servers.' },
  { q: 'Can I run backup commands from a server channel?', a: 'No. All commands must be sent to the bot via DMs. The bot ignores commands in server channels.' },
  { q: 'Can the bot back up a server while people are active in it?', a: 'Yes. The backup reads the server structure at a point in time and does not require the server to be inactive.' },
  { q: 'Does the backup capture the server\'s current boost tier?', a: 'No. Boost tier depends on active boosts from members and is not restorable by the bot.' },
  { q: 'What is #$verifybackup used for?', a: 'It downloads and decompresses a backup to confirm it can be fully parsed. It reports role, channel, and member counts. Run this before a restore to make sure the backup is valid.' },
  { q: 'What is #$diff used for?', a: 'It compares two backup snapshots of the same server side by side, showing what changed between them in terms of roles, channels, and member counts.' },
  { q: 'How do I check how many backups I have for a server?', a: 'Run #$backups <server_id>. It lists all backups with their number, timestamp, and file size.' },
  { q: 'Can I have a backup of a server I no longer own?', a: 'No. Backup access is tied to server ownership. If you no longer own the server you cannot access its backups unless you were the original creator.' },
  { q: 'What is the #$saveall command?', a: 'It refreshes backups for every server that already has at least one existing backup. Servers with no prior backup are skipped. Owner only.' },
  { q: 'Can I back up a server I was banned from?', a: 'No. The bot needs to be able to join the server. If you are banned you cannot invite the bot.' },
  { q: 'What is the fastest way to restore a server after it gets nuked?', a: 'Run #$load <server_id> <new_server_id> using your most recent backup. Set up #$autobackup so you always have a recent backup ready.' },
  { q: 'What does the admin panel on this website show?', a: 'The admin panel is only accessible with a password. It shows live server data, backup inventory, error logs, autobackup schedules, access control, and quick answers.' },
  { q: 'How do I set the admin panel password?', a: 'The bot owner runs #$setdashpass <password> in DMs with the bot to set the dashboard password hash.' },
  { q: 'Is the admin panel public?', a: 'No. It requires a password to access and is intended for the bot owner only.' },
  { q: 'How often does the dashboard update?', a: 'The dashboard data is refreshed from the bot every 5 minutes automatically, or you can click Refresh to update immediately.' },
  { q: 'What does \'stale backup\' mean on the dashboard?', a: 'A stale backup warning appears when a server has not been backed up in more than 7 days. It is a reminder to run #$save again.' },
  { q: 'Can I export backup data from the admin panel?', a: 'Yes. The admin panel has an Export JSON button in the Backups tab that downloads a full backup inventory file.' },
  { q: 'How do I copy a server ID from the admin panel?', a: 'Click on any server ID displayed in the admin panel. It copies to your clipboard automatically.' },
  { q: 'Can I use autobackup on a server I am a manager of?', a: 'Yes. Managers can set up autobackup schedules. Run #$autobackup <server_id> <hours> and follow the prompts.' },
  { q: 'What happens to shared access when a backup expires?', a: 'The backup is deleted along with all shared access records for it. Users will need to be re-granted access if a new backup is created.' },
  { q: 'Can I back up a server that is currently being raided?', a: 'Yes. The bot reads the server structure at the time of backup. You may want to run #$save immediately after a raid to capture any cleanup you have done.' },
  { q: 'Does the bot work if my server has the maximum number of roles?', a: 'The bot can read and restore up to Discord\'s maximum role limit per server. If the target server already has roles it will clear them first during a restore.' },
  { q: 'Does the bot work with emoji-only role names or special characters?', a: 'Yes. Role and channel names including emoji, special characters, and unicode are fully supported.' },
  { q: 'Can the backup be used to transfer a server to a different owner?', a: 'The backup preserves structure. To effectively transfer, restore the backup onto a new server that the new owner controls.' },
  { q: 'Can I back up a server that has age-restricted channels?', a: 'Yes. Age-restricted (NSFW) channel settings are fully backed up and restored along with all other channel configurations.' },
  { q: 'Does the bot support backing up forum channels?', a: 'Yes. Forum channels and their post configurations are included in backups.' },
  { q: 'What happens if I run #$load on a server that already has channels?', a: 'All existing channels and roles on the target server are deleted before the backup is applied. The server is fully rebuilt from the backup.' },
  { q: 'Can I run #$save on a server that currently has an active autobackup?', a: 'Yes. Manual #$save and autobackup schedules are independent. Running #$save manually creates an additional backup entry alongside the scheduled ones.' },
  { q: 'Does running #$save cancel my autobackup schedule?', a: 'No. Manual saves and autobackup schedules are completely independent. Your schedule continues unchanged.' },
  { q: 'Is there a way to see the full list of bot commands?', a: 'Yes. Run #$help in DMs with the bot for a full command list, or check the Commands tab on this website.' },
];

const PUBLIC_FAQ: FaqEntry[] = [
  {
    q: 'What is this bot?',
    a: 'A Discord bot that backs up and restores your entire server — roles, channels, members, emojis, bans, webhooks, and more. Run #$save to create a backup and #$load to restore it.',
  },
  {
    q: 'Is it free?',
    a: 'Yes, completely free. No subscriptions, no paywalls.',
  },
  {
    q: 'What does a backup include?',
    a: 'Roles, channels, categories, emojis, stickers, bans, members, webhooks, automod rules, scheduled events, welcome screen, soundboard, threads, and optionally message history.',
  },
  {
    q: 'Who can use it?',
    a: 'Any Discord server owner with 20+ members can use the bot. If your server has fewer than 20 members you can request a manual backup in the support server.',
  },
  {
    q: 'Is it safe?',
    a: 'Backups are stored securely and are only accessible to the server owner who created them. The bot cannot access your server without being invited.',
  },
  {
    q: 'How long does a backup take?',
    a: 'Most servers back up in under a minute. Large servers with thousands of members or hundreds of channels may take a few minutes. Restores take slightly longer.',
  },
];

const TABS = [
  { id: 'commands', label: 'Commands' },
  { id: 'uptime', label: 'Status' },
  { id: 'changelog', label: 'Changelog' },
  { id: 'faq', label: 'FAQ' },
  { id: 'tryit', label: 'Try It' },
  { id: 'architecture', label: 'How It Works' },
  { id: 'tos', label: 'Terms' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'admin', label: '⚙️ Admin' },
];

const PERMISSIONS = [
  {
    level: 'Owner',
    color: '#ED4245',
    desc: 'Full unrestricted access to all bot functionality',
    cmds: 'Everything',
  },
  {
    level: 'Manager',
    color: '#EB459E',
    desc: 'All Admin permissions plus the ability to trigger server backups',
    cmds: 'Admin + save',
  },
  {
    level: 'Admin',
    color: '#FEE75C',
    desc: 'Access control, server info, whitelist/blocklist management',
    cmds: '10+ commands',
  },
  {
    level: 'Server Owner',
    color: '#5865F2',
    desc: 'Can back up and restore their own server only (20+ members to save)',
    cmds: 'Backup commands',
  },
];

const BACKUP_RULES = [
  {
    icon: '📏',
    title: '20-member minimum to save',
    desc: 'Servers under 20 members receive a support server invite and the bot leaves. Whitelisted servers bypass this.',
  },
  {
    icon: '🔐',
    title: 'Ownership is tracked per server',
    desc: "When a backup is saved, the server is registered to the owner's account. You can only load your own server's backups.",
  },
  {
    icon: '🚫',
    title: 'Cross-server loading blocked',
    desc: "Even if you know another server's backup ID, you cannot load it. Ownership is verified on every load attempt.",
  },
  {
    icon: '♾️',
    title: 'No member limit to load',
    desc: 'You can restore a backup to your server regardless of its current member count. The limit only applies to saving.',
  },
  {
    icon: '✅',
    title: 'Whitelist overrides member limit',
    desc: 'The bot owner can whitelist specific servers or users to bypass the 20-member requirement entirely.',
  },
  {
    icon: '🛑',
    title: 'Blocklist prevents all access',
    desc: 'Blocked servers or users are denied all backup operations (save and load) with no override.',
  },
];

const BACKUP_CONTENTS = [
  'Roles & permissions',
  'Channels & categories',
  'Emojis & stickers',
  'Bans & member list',
  'Webhooks',
  'AutoMod rules',
  'Scheduled events',
  'Welcome screen',
  'Soundboard sounds',
  'Threads',
  'Server settings',
  'Optionally: messages',
];

const STORAGE_ITEMS = [
  { icon: '📦', label: 'Backup format', value: 'Compressed archive' },
  { icon: '☁️', label: 'Where stored', value: 'Securely on our servers' },
  { icon: '♻️', label: 'Persistence', value: 'Survives bot restarts' },
  {
    icon: '🗂️',
    label: 'Multiple backups',
    value: 'Auto-deleted after 30 days',
  },
];

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '12px'})`,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s, transform 0.2s',
        pointerEvents: 'none',
        zIndex: 9999,
        background: '#1e2030',
        border: '1px solid rgba(88,101,242,0.5)',
        borderRadius: 8,
        padding: '9px 18px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        color: '#5865F2',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}
    >
      ✓ {message}
    </div>
  );
}

function PingDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: color,
          opacity: 0.5,
          animation: 'ping 1.4s cubic-bezier(0,0,0.2,1) infinite',
        }}
      />
      <span
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
        }}
      />
    </span>
  );
}

function useCountUp(target: number, duration = 1500, start = false): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    let frameId: number;
    const step = (ts: number) => {
      if (startTime === null) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      setVal(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration, start]);
  return val;
}

function StatCard({
  label,
  value,
  suffix,
  delay,
  started,
}: StatItem & { key?: React.Key; delay: number; started: boolean }) {
  const count = useCountUp(value, 1200 + delay * 100, started);
  const isLarge = value >= 10000;
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('stat-compact') === 'true'; } catch { return false; }
  });

  const toggle = () => {
    if (!isLarge) return;
    const next = !compact;
    setCompact(next);
    try { localStorage.setItem('stat-compact', String(next)); } catch {}
  };

  const display = isLarge && compact
    ? `${Math.floor(count / 1000)}K`
    : count.toLocaleString();

  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid rgba(88,101,242,0.3)',
        borderRadius: 12,
        padding: '20px 12px',
        textAlign: 'center',
        transition: 'border-color 0.3s',
        cursor: isLarge ? 'pointer' : 'default',
      }}
      onClick={toggle}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          'rgba(88,101,242,0.8)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          'rgba(88,101,242,0.3)';
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 36,
          fontWeight: 700,
          color: '#5865F2',
          letterSpacing: -1,
        }}
      >
        {display}
        {suffix}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function CommandGroup({
  name,
  data,
  isOpen,
  onToggle,
  filtered,
  copiedCmd,
  copyCmd,
}: {
  key?: React.Key;
  name: string;
  data: CommandGroupData;
  isOpen: boolean;
  onToggle: () => void;
  filtered: Cmd[] | undefined;
  copiedCmd: string | null;
  copyCmd: (cmd: Cmd) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState('0px');
  const cmdsToShow = filtered ?? data.cmds;
  useEffect(() => {
    if (contentRef.current)
      setHeight(isOpen ? `${contentRef.current.scrollHeight}px` : '0px');
  }, [isOpen, cmdsToShow.length]);
  return (
    <div
      style={{
        border: `1px solid ${
          isOpen ? data.color + '55' : 'var(--border)'
        }`,
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'border-color 0.25s',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          cursor: 'pointer',
          userSelect: 'none',
          background: isOpen ? `${data.color}18` : 'var(--surface)',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'var(--surface2)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'var(--surface)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>{data.icon}</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
              color: 'var(--t)',
              fontSize: 14,
            }}
          >
            {name}
          </span>
          <span
            style={{
              background: `${data.color}33`,
              color: data.color,
              borderRadius: 20,
              padding: '1px 8px',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
            }}
          >
            {filtered
              ? `${filtered.length}/${data.cmds.length}`
              : data.cmds.length}
          </span>
        </div>
        <span
          style={{
            color: 'var(--muted)',
            fontSize: 12,
            display: 'inline-block',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s ease',
          }}
        >
          ▶
        </span>
      </div>
      <div
        style={{
          maxHeight: height,
          overflow: 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div ref={contentRef} style={{ padding: '4px 0 8px' }}>
          {cmdsToShow.map((cmd, i) => {
            const cmdText = cmd.args
              ? `#$${cmd.name} ${cmd.args}`
              : `#$${cmd.name}`;
            const isCopied = copiedCmd === cmdText;
            return (
              <div
                key={i}
                onClick={() => copyCmd(cmd)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '8px 18px',
                  borderBottom:
                    i < cmdsToShow.length - 1
                      ? '1px solid var(--border)'
                      : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: isCopied ? `${data.color}18` : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isCopied)
                    (e.currentTarget as HTMLDivElement).style.background =
                      'var(--surface2)';
                }}
                onMouseLeave={(e) => {
                  if (!isCopied)
                    (e.currentTarget as HTMLDivElement).style.background =
                      'transparent';
                }}
              >
                <div style={{ minWidth: 210 }}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 12,
                      color: data.color,
                      fontWeight: 700,
                    }}
                  >
                    #${cmd.name}
                  </span>
                  {cmd.args && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: 'var(--muted)',
                      }}
                    >
                      {' '}
                      {cmd.args}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    lineHeight: 1.6,
                    flex: 1,
                  }}
                >
                  {cmd.desc}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: PERM_COLORS[cmd.perm],
                    background: `${PERM_COLORS[cmd.perm]}18`,
                    border: `1px solid ${PERM_COLORS[cmd.perm]}44`,
                    borderRadius: 4,
                    padding: '1px 6px',
                    flexShrink: 0,
                    alignSelf: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cmd.perm}
                </span>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: isCopied ? data.color : 'var(--faint)',
                    marginLeft: 8,
                    flexShrink: 0,
                    alignSelf: 'center',
                    transition: 'color 0.2s',
                  }}
                >
                  {isCopied ? '✓ copied' : 'click to copy'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FaqItem({
  item,
  isOpen,
  onToggle,
}: {
  key?: React.Key;
  item: FaqEntry;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState('0px');
  useEffect(() => {
    if (contentRef.current)
      setHeight(isOpen ? `${contentRef.current.scrollHeight}px` : '0px');
  }, [isOpen]);
  return (
    <div
      style={{
        border: `1px solid ${
          isOpen ? 'rgba(88,101,242,0.5)' : 'var(--border)'
        }`,
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          cursor: 'pointer',
          userSelect: 'none',
          background: isOpen
            ? 'rgba(88,101,242,0.08)'
            : 'var(--surface)',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'var(--surface2)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'var(--surface)';
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: isOpen ? 'var(--t)' : 'var(--t)',
            fontWeight: isOpen ? 600 : 400,
          }}
        >
          {item.q}
        </span>
        <span
          style={{
            color: 'var(--muted)',
            fontSize: 12,
            display: 'inline-block',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s ease',
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          ▶
        </span>
      </div>
      <div
        style={{
          maxHeight: height,
          overflow: 'hidden',
          transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div
          ref={contentRef}
          style={{
            padding: '12px 18px 16px',
            fontSize: 13,
            color: 'var(--muted)',
            lineHeight: 1.7,
            borderTop: '1px solid var(--border)',
          }}
        >
          {item.a}
        </div>
      </div>
    </div>
  );
}

function calcUptimePct(
  downtimeLog: DowntimeEntry[],
  totalDays: number
): number {
  if (totalDays <= 0) return 100;
  const windowStart = Date.now() - totalDays * 86400 * 1000;
  const windowEnd = Date.now();
  let downMs = 0;
  for (const e of downtimeLog) {
    const start = new Date(e.server_went_down_approx).getTime();
    const end = start + (e.duration_seconds || 0) * 1000;
    const clampedStart = Math.max(start, windowStart);
    const clampedEnd = Math.min(end, windowEnd);
    if (clampedEnd > clampedStart) {
      downMs += clampedEnd - clampedStart;
    }
  }
  const downSeconds = downMs / 1000;
  return Math.max(
    0,
    parseFloat(((1 - downSeconds / (totalDays * 86400)) * 100).toFixed(2))
  );
}

function getDayGradient(
  dayStartMs: number,
  dayEndMs: number,
  downtimeLog: DowntimeEntry[]
): string {
  const dayDuration = dayEndMs - dayStartMs;
  const incidents = downtimeLog
    .filter((e) => {
      const t = new Date(e.server_went_down_approx).getTime();
      const end = t + (e.duration_seconds || 0) * 1000;
      return t < dayEndMs && end > dayStartMs;
    })
    .map((e) => {
      const t = new Date(e.server_went_down_approx).getTime();
      return {
        start: Math.max(0, (t - dayStartMs) / dayDuration),
        end: Math.min(
          1,
          (t + (e.duration_seconds || 0) * 1000 - dayStartMs) / dayDuration
        ),
      };
    })
    .sort((a, b) => a.start - b.start);

  if (incidents.length === 0) return '#57F28799';

  const merged: { start: number; end: number }[] = [];
  for (const inc of incidents) {
    if (merged.length && inc.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        inc.end
      );
    } else {
      merged.push({ ...inc });
    }
  }

  const stops: string[] = [];
  let pos = 0;
  for (const inc of merged) {
    if (inc.start > pos) {
      stops.push(
        `#57F28799 ${(pos * 100).toFixed(1)}%`,
        `#57F28799 ${(inc.start * 100).toFixed(1)}%`
      );
    }
    stops.push(
      `#ED424599 ${(inc.start * 100).toFixed(1)}%`,
      `#ED424599 ${(inc.end * 100).toFixed(1)}%`
    );
    pos = inc.end;
  }
  if (pos < 1) {
    stops.push(`#57F28799 ${(pos * 100).toFixed(1)}%`, `#57F28799 100%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function isBotOnline(heartbeat: Heartbeat, fetchedAt: number | null): boolean | null {
  if (!heartbeat) return null;
  // Measure heartbeat age at the moment we fetched, not now;
  // otherwise a 60s fetch interval + 4min old heartbeat = false offline
  const reference = fetchedAt ?? Date.now();
  return reference - new Date(heartbeat.last_seen).getTime() < 5 * 60 * 1000;
}

const TRY_IT_EXAMPLES = [
  {
    cmd: '#$save 8294710365820194',
    desc: 'Back up a server',
    conversation: [
      { from: 'bot', lines: [
        '📦 Configuring backup of **Neon Lounge**',
        '',
        '**Step 1/5: Channel/category blacklist**',
        'Enter comma-separated channel/category names to skip, or reply `skip` for none:',
      ]},
      { from: 'user', text: 'skip' },
      { from: 'bot', lines: [
        '**Step 2/5: Save member data?**',
        'Reply `yes` to save members or `no` to skip.',
      ]},
      { from: 'user', text: 'yes' },
      { from: 'bot', lines: [
        '**Step 3/5: Member filter**',
        'Reply `all`, `whitelist <ids>`, or `blacklist <ids>`.',
      ]},
      { from: 'user', text: 'all' },
      { from: 'bot', lines: [
        '**Step 4/5: Backup format**',
        'Reply `1`–`5` (default: 5 = lzma, smallest).',
      ]},
      { from: 'user', text: '5' },
      { from: 'bot', lines: [
        '**Step 5/5: Message capture**',
        'Reply `c <channel_id>` to capture a channel, or `done` to skip.',
      ]},
      { from: 'user', text: 'done' },
      { from: 'bot', lines: [
        '🚀 Starting backup of **Neon Lounge**…',
        '',
        '✅ Backup of **Neon Lounge** complete! **874.2 KB** — took 38s',
      ]},
    ],
  },
  {
    cmd: '#$backups 8294710365820194',
    desc: 'List backups',
    conversation: [
      { from: 'bot', lines: [
        '📦 **3 backup(s)** for server `8294710365820194` (newest first)',
        '',
        '  **1.** `2026-03-06 14:03:55 UTC`  •  874.2 KB  •  28d left',
        '  **2.** `2026-03-05 09:22:11 UTC`  •  871.0 KB  •  27d left',
        '  **3.** `2026-03-04 11:51:48 UTC`  •  868.5 KB  •  26d left',
        '',
        'Use `#$delbackup 8294710365820194 <number>` to delete a specific backup.',
      ]},
    ],
  },
  {
    cmd: '#$verifybackup 8294710365820194',
    desc: 'Verify a backup',
    conversation: [
      { from: 'bot', lines: [
        '✅ **Backup #1 verified, no errors!**',
        '',
        '📅 Saved: `2026-03-06 14:03:55 UTC`',
        '📦 Size: 874.2 KB',
        '',
        '🏠 **Neon Lounge** (ID: `8294710365820194`)',
        '  👥 Members: **318**  •  Bans: **4**',
        '  📋 Roles: **28**',
        '  💬 Channels: **41**  •  Categories: **9**  •  Threads: **2**',
        '  😀 Emojis: **18**  •  Stickers: **2**',
        '  🪝 Webhooks: **1**',
        '  📨 Captured messages: **0** across **0** channel(s)',
        '',
        '🔍 **Live vs Backup Diff**',
        '  ✅ Members: **318** (unchanged)',
        '  ✅ Roles: **28** (unchanged)',
        '  🟡 Channels: **41** in backup vs **43** live (↑+2)',
      ]},
    ],
  },
  {
    cmd: '#$autobackup 8294710365820194 24',
    desc: 'Schedule autobackups',
    conversation: [
      { from: 'bot', lines: [
        '✅ Autobackup scheduled for **Neon Lounge** every **24h**.',
        'First run: immediately.',
      ]},
    ],
  },
  {
    cmd: '#$info 8294710365820194',
    desc: 'View server info',
    conversation: [
      { from: 'bot', lines: [
        '🏠 **Neon Lounge** (`8294710365820194`)',
        '👑 Owner: potato#0001 (`198765432100000001`)',
        '👥 Members: 318',
        '📋 Roles: 28',
        '📂 Channels: 43',
        '😀 Emojis: 18',
        '🚀 Boost: Tier 1 (4 boosts)',
        '🌐 Locale: en-US',
        '🔒 Verification: medium',
      ]},
    ],
  },
  {
    cmd: '#$diff 8294710365820194 1 2',
    desc: 'Diff two backups',
    conversation: [
      { from: 'bot', lines: [
        '🔍 **Diff: Neon Lounge** — backup #2 vs #1',
        '',
        '**Roles** — 1 change',
        '  ➕ Added: `Trial Member`',
        '',
        '**Channels** — 3 changes',
        '  ➕ Added: `#announcements-v2`',
        '  ➖ Removed: `#old-chat`',
        '  ✏️  Renamed: `#general` → `#general-chat`',
        '',
        '**Members** — no change  •  **Emojis** — no change',
      ]},
    ],
  },
  {
    cmd: '#$sharebackup 8294710365820194 198765432100000099',
    desc: 'Share backup access',
    conversation: [
      { from: 'bot', lines: [
        '✅ **backup_user#4242** now has shared access to backups for **Neon Lounge**.',
        'They can run `#$load 8294710365820194 <target>` to restore it.',
        '',
        'Use `#$unsharebackup 8294710365820194 198765432100000099` to revoke.',
      ]},
    ],
  },
  {
    cmd: '#$load 8294710365820194 9182736450192837',
    desc: 'Restore a backup',
    conversation: [
      { from: 'bot', lines: [
        '📦 **3 backup(s)** found for **Neon Lounge**. Reply with a number to pick one:',
        '',
        '  **1.** `2026-03-06 14:03:55 UTC`  •  874.2 KB  ← newest',
        '  **2.** `2026-03-05 09:22:11 UTC`  •  871.0 KB',
        '  **3.** `2026-03-04 11:51:48 UTC`  •  868.5 KB',
      ]},
      { from: 'user', text: '1' },
      { from: 'bot', lines: [
        '⚠️  This will **delete all existing channels and roles** on **Empty Server** and replace them.',
        'Reply `confirm` to continue or anything else to cancel.',
      ]},
      { from: 'user', text: 'confirm' },
      { from: 'bot', lines: [
        '🔄 Restoring **Neon Lounge** → **Empty Server**…',
        '',
        '✅ Restore complete! Took **1m 12s**',
        '  📋 Roles: 28  •  💬 Channels: 41  •  👥 Members: 318',
      ]},
    ],
  },
  {
    cmd: '#$delbackup 8294710365820194 3',
    desc: 'Delete a backup',
    conversation: [
      { from: 'bot', lines: [
        '🗑️ Deleted backup **#3** (`2026-03-04 11:51:48 UTC`) for **Neon Lounge**.',
        '2 backup(s) remaining.',
      ]},
    ],
  },
];

// ─── Admin Panel ────────────────────────────────────────────────────────────

// Hash a password using PBKDF2-SHA256 (same params as main.py dashboard_password_hash).
// Returns hex string. Falls back to a simple SHA-256 if SubtleCrypto unavailable.
async function hashPassword(password: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('discord-backup-bot'), iterations: 100000 },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // fallback: plain SHA-256
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

type AdminView = 'dashboard' | 'backups' | 'servers' | 'access' | 'logs' | 'quick_answers';

function QuickAnswerRow({ item, theme }: { item: FaqEntry; theme: Record<string, string> }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard.writeText(item.a).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{ background: theme.surface2 ?? 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 14px', border: `1px solid ${theme.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: theme.text, marginBottom: 4 }}>{item.q}</div>
          <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.5 }}>{item.a}</div>
        </div>
        <button onClick={copy} style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 6, border: `1px solid ${theme.border}`, background: copied ? 'rgba(87,242,135,0.15)' : 'transparent', color: copied ? '#57F287' : theme.muted, fontSize: 11, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ theme, darkMode, liveData, onRefresh, refreshing, lastSynced }: { theme: Record<string,string>; darkMode: boolean; liveData: any; onRefresh: () => Promise<void>; refreshing: boolean; lastSynced: number | null }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);
  const [pwChecking, setPwChecking] = useState(false);
  const [view, setView] = useState<AdminView>('dashboard');
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [serverSort, setServerSort] = useState<'members_desc' | 'members_asc' | 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'backed_up'>('members_desc');
  const [serverSearch, setServerSearch] = useState('');
  const [backupSearch, setBackupSearch] = useState('');
  const [errorSearch, setErrorSearch] = useState('');
  const [quickSearch, setQuickSearch] = useState('');

  const ADMIN_VIEWS: { id: AdminView; label: string; icon: string }[] = [
    { id: 'dashboard',     label: 'Dashboard',      icon: '📊' },
    { id: 'servers',       label: 'Servers',        icon: '🌐' },
    { id: 'backups',       label: 'Backups',        icon: '💾' },
    { id: 'access',        label: 'Access Control', icon: '🔐' },
    { id: 'logs',          label: 'Error Log',      icon: '❌' },
    { id: 'quick_answers', label: 'Quick Answers',  icon: '💬' },
  ];

  // ── Real data from liveData (data.json) ──────────────────────────────────
  const realAdmins:    string[]                    = (liveData?.admins   ?? []).map(String);
  const realManagers:  string[]                    = (liveData?.managers ?? []).map(String);
  const backupOwners:  Record<string,string>       = liveData?.backup_owners           ?? {};
  const sharedAccess:  Record<string,string[]>     = liveData?.backup_shared_access    ?? {};
  const wlGuilds:      string[]                    = liveData?.backup_whitelist_guilds ?? [];
  const wlUsers:       string[]                    = liveData?.backup_whitelist_users  ?? [];
  const blGuilds:      string[]                    = liveData?.backup_blocked_guilds   ?? [];
  const blUsers:       string[]                    = liveData?.backup_blocked_users    ?? [];
  const downtimeEvents                             = liveData?.downtime_log            ?? [];
  const guildSnap:     Record<string,GuildInfo>    = liveData?.guild_snapshot          ?? {};
  const userCache:     Record<string,UserInfo>     = liveData?.user_cache              ?? {};
  const backupInv:     Record<string,BackupEntry[]> = liveData?.backup_inventory       ?? {};
  const autobackupSchedules: Record<string, { interval_hours: number; last_run_ts: number; notify_channel_id?: number; ch_bl?: string[]; save_mb?: boolean; fmt_v?: number; encrypt_password?: string | null }> = liveData?.autobackup_schedules ?? {};

  // Helper: resolve a user ID to a display string
  const resolveUser = (id: string) => {
    const u = userCache[id];
    if (!u) return { label: id, sub: null, avatar: null };
    return {
      label: u.display_name || u.name,
      sub:   u.name !== u.display_name ? u.name : null,
      avatar: u.avatar_url,
    };
  };

  // Helper: copy text to clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Helper: estimate save/restore duration based on server size
  const estimateSaveTime = (g: GuildInfo | undefined) => {
    if (!g) return null;
    // Rough heuristic: ~2s base + 0.05s/member + 0.3s/channel + 0.2s/role
    const secs = 2 + g.member_count * 0.05 + g.channel_count * 0.3 + g.role_count * 0.2;
    if (secs < 60) return `~${Math.round(secs)}s`;
    return `~${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  };
  const estimateRestoreTime = (g: GuildInfo | undefined) => {
    if (!g) return null;
    // Restore is slower: role creation is rate-limited at ~3s/role + channel creation
    const secs = 5 + g.role_count * 3.2 + g.channel_count * 0.8 + g.member_count * 0.02;
    if (secs < 60) return `~${Math.round(secs)}s`;
    return `~${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  };

  // Helper: days since last backup for a server
  const daysSinceBackup = (sid: string): number | null => {
    const entries = backupInv[sid];
    if (!entries?.length) return null;
    const latest = entries.reduce((best, e) => (e.timestamp_iso && (!best || e.timestamp_iso > best) ? e.timestamp_iso : best), '');
    if (!latest) return null;
    return Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
  };

  // Export backup inventory as JSON
  const exportInventory = () => {
    const data = JSON.stringify({ exported_at: new Date().toISOString(), backup_inventory: backupInv }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'backup-inventory.json'; a.click();
    URL.revokeObjectURL(url);
  };

  // All guilds the bot is in (live snapshot)
  const allGuilds = Object.values(guildSnap);
  // Servers with backups, sourced from forum scan (backup_inventory), not backup_owners
  const backupServerIds = Object.keys(backupInv);

  // Access list: owner row + managers + admins
  const OWNER_ID_STR = '1425423027335598090';
  const seenIds = new Set<string>();
  const accessList = [
    { id: OWNER_ID_STR, role: 'Owner' as const },
    ...realManagers.filter(id => id !== OWNER_ID_STR).map(id => ({ id, role: 'Manager' as const })),
    ...realAdmins.filter(id => id !== OWNER_ID_STR).map(id => ({ id, role: 'Admin' as const })),
  ].filter(a => { const s = String(a.id); if (seenIds.has(s)) return false; seenIds.add(s); return true; });

  const card = (content: React.ReactElement, style?: React.CSSProperties) => (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 20, ...style }}>
      {content}
    </div>
  );

  const statBox = (label: string, value: string | number, icon: string, color = '#5865F2') => (
    <div style={{ background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '14px 18px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'monospace', marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: theme.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );

  // Hash-based password verification against data.json's dashboard_password_hash
  const storedHash: string | undefined = liveData?.dashboard_password_hash;

  const attemptLogin = async () => {
    if (!pw || pwChecking) return;
    setPwChecking(true);
    try {
      if (!storedHash) {
        // No hash configured — show instructions
        setPwError(true);
        setPwChecking(false);
        return;
      }
      const hashed = await hashPassword(pw);
      if (hashed === storedHash) {
        setAuthed(true);
        setPwError(false);
      } else {
        setPwError(true);
        setPw('');
      }
    } catch {
      setPwError(true);
      setPw('');
    }
    setPwChecking(false);
  };

  if (!authed) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 20 }}>
      <div style={{ fontSize: 40 }}>🔐</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>Admin Access</div>
      {!storedHash
        ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#FEE75C', background: 'rgba(254,231,92,0.1)', border: '1px solid rgba(254,231,92,0.3)', borderRadius: 8, padding: '10px 16px', maxWidth: 380, textAlign: 'center' }}>
              No password detected. Run <code style={{ color: '#FEE75C' }}>#$setdashpass &lt;password&gt;</code> in Discord to set one.
            </div>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{ padding: '7px 16px', borderRadius: 7, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.muted, fontSize: 12, cursor: refreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>↻</span>
              {refreshing ? 'Checking…' : 'Check Again'}
            </button>
          </div>
        : <div style={{ fontSize: 13, color: theme.muted }}>Enter the admin password to continue</div>
      }
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="password"
          value={pw}
          placeholder="Password"
          disabled={!storedHash || pwChecking}
          onChange={e => { setPw(e.target.value); setPwError(false); }}
          onKeyDown={e => { if (e.key === 'Enter') attemptLogin(); }}
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${pwError ? '#ED4245' : theme.border2}`,
            background: 'var(--input-bg)', color: theme.text, fontFamily: 'monospace',
            fontSize: 14, outline: 'none', width: 200, opacity: !storedHash ? 0.5 : 1,
          }}
        />
        <button
          onClick={attemptLogin}
          disabled={!storedHash || pwChecking}
          style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: (!storedHash || pwChecking) ? 'not-allowed' : 'pointer', fontSize: 13, opacity: (!storedHash || pwChecking) ? 0.6 : 1 }}
        >
          {pwChecking ? '…' : 'Unlock'}
        </button>
      </div>
      {pwError && storedHash && <div style={{ color: '#ED4245', fontSize: 12 }}>❌ Incorrect password</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Sidebar */}
      <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ADMIN_VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            padding: '9px 14px', borderRadius: 8, border: 'none', textAlign: 'left', cursor: 'pointer',
            background: view === v.id ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: view === v.id ? '#5865F2' : theme.text,
            fontWeight: view === v.id ? 700 : 400, fontSize: 13,
            transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>{v.icon} {v.label}</span>
            {v.id === 'logs' && (liveData?.error_log ?? []).length > 0 && (
              <span style={{ marginLeft: 'auto', background: '#ED4245', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                {(liveData.error_log.length > 99 ? '99+' : liveData.error_log.length)}
              </span>
            )}
          </button>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none', width: '100%',
              background: refreshing ? 'rgba(88,101,242,0.15)' : '#5865F2',
              color: refreshing ? '#5865F2' : '#fff',
              fontSize: 12, cursor: refreshing ? 'not-allowed' : 'pointer',
              fontWeight: 700, transition: 'background 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>↻</span>
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
          {lastSynced && (
            <div style={{ fontSize: 10, color: theme.muted, textAlign: 'center', fontFamily: 'monospace' }}>
              synced {new Date(lastSynced).toLocaleTimeString()}
            </div>
          )}
          <button onClick={() => setAuthed(false)} style={{
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, width: '100%',
            background: 'transparent', color: theme.muted, fontSize: 12, cursor: 'pointer',
          }}>
            🔒 Lock
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {view === 'dashboard' && <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {statBox('Bot In', allGuilds.length, '🌐')}
            {statBox('Backups', Object.values(backupInv).reduce((n, arr) => n + arr.length, 0), '💾', '#57F287')}
            {statBox('Servers Backed Up', backupServerIds.length, '🗄️', '#57F287')}
            {statBox('Managers', realManagers.length, '🔷', '#5865F2')}
            {statBox('Admins', realAdmins.length, '👤', '#EB459E')}
            {statBox('Blocked', blGuilds.length + blUsers.length, '🚫', '#ED4245')}
          </div>

          {/* Live guild overview */}
          {allGuilds.length > 0 && card(<>
            <div style={{ fontWeight: 700, marginBottom: 12, color: theme.text }}>🌐 Guild Overview</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...allGuilds].sort((a,b) => b.member_count - a.member_count).slice(0,6).map(g => {
                const hasBackup = !!(backupInv[g.id]?.length);
                const days = daysSinceBackup(g.id);
                const stale = days !== null && days > 7;
                return (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                    {g.icon_url
                      ? <img src={g.icon_url} style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }} />
                      : <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(88,101,242,0.2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>?</div>
                    }
                    <span style={{ fontWeight: 700, color: theme.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <span
                      onClick={() => copyId(g.id)}
                      title="Copy server ID"
                      style={{ color: copiedId === g.id ? 'var(--green)' : theme.muted, fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', padding: '1px 4px', borderRadius: 3, background: 'rgba(88,101,242,0.07)', userSelect: 'none' }}
                    >{copiedId === g.id ? '✓' : g.id}</span>
                    <span style={{ color: theme.muted }}>👥 {g.member_count.toLocaleString()}</span>
                    <span style={{ color: theme.muted }}>💬 {g.channel_count}</span>
                    {g.boost_level > 0 && <span style={{ color: '#EB459E' }}>✨ L{g.boost_level}</span>}
                    {stale && <span style={{ fontSize: 10, color: '#FEE75C', background: 'rgba(254,231,92,0.1)', border: '1px solid rgba(254,231,92,0.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>⚠️ {days}d ago</span>}
                    <span style={{ color: hasBackup ? 'var(--green)' : theme.muted, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: hasBackup ? 'rgba(87,242,135,0.1)' : 'transparent', border: `1px solid ${hasBackup ? 'rgba(87,242,135,0.3)' : 'transparent'}` }}>
                      {hasBackup ? '💾 backed up' : 'no backup'}
                    </span>
                  </div>
                );
              })}
              {allGuilds.length > 6 && <div style={{ fontSize: 11, color: theme.muted, paddingTop: 4 }}>+{allGuilds.length - 6} more, see Servers tab</div>}
            </div>
          </>)}

          {/* Whitelist / Blocklist */}
          {(wlGuilds.length > 0 || wlUsers.length > 0 || blGuilds.length > 0 || blUsers.length > 0) && card(<>
            <div style={{ fontWeight: 700, marginBottom: 10, color: theme.text }}>🛡️ Whitelist / Blocklist</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wlGuilds.map(id => {
                const g = guildSnap[id];
                return <div key={id} style={{ background: 'rgba(87,242,135,0.08)', border: '1px solid rgba(87,242,135,0.25)', borderRadius: 7, padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>✅ WL Guild</span>
                  <span style={{ color: theme.text }}>{g?.name ?? id}</span>
                  <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code>
                </div>;
              })}
              {wlUsers.map(id => {
                const u = resolveUser(id);
                return <div key={id} style={{ background: 'rgba(87,242,135,0.08)', border: '1px solid rgba(87,242,135,0.25)', borderRadius: 7, padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>✅ WL User</span>
                  <span style={{ color: theme.text }}>{u.label}</span>
                  <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code>
                </div>;
              })}
              {blGuilds.map(id => {
                const g = guildSnap[id];
                return <div key={id} style={{ background: 'rgba(237,66,69,0.08)', border: '1px solid rgba(237,66,69,0.25)', borderRadius: 7, padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#ED4245', fontWeight: 700 }}>🚫 Blocked Guild</span>
                  <span style={{ color: theme.text }}>{g?.name ?? id}</span>
                  <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code>
                </div>;
              })}
              {blUsers.map(id => {
                const u = resolveUser(id);
                return <div key={id} style={{ background: 'rgba(237,66,69,0.08)', border: '1px solid rgba(237,66,69,0.25)', borderRadius: 7, padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#ED4245', fontWeight: 700 }}>🚫 Blocked User</span>
                  <span style={{ color: theme.text }}>{u.label}</span>
                  <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code>
                </div>;
              })}
            </div>
          </>)}

          {/* Recent downtime */}
          {downtimeEvents.length > 0 && card(<>
            <div style={{ fontWeight: 700, marginBottom: 12, color: theme.text }}>📉 Recent Downtime</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[...downtimeEvents].reverse().slice(0,4).map((d,i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '6px 0', borderBottom: i < 3 ? `1px solid ${theme.border}` : 'none', alignItems: 'center' }}>
                  <span style={{ color: theme.muted, fontFamily: 'monospace', flexShrink: 0, fontSize: 11 }}>{d.server_went_down_approx}</span>
                  <span style={{ color: '#ED4245', flex: 1 }}>{d.reason}</span>
                  <span style={{ color: theme.muted }}>{d.duration_human}</span>
                  <span style={{ color: d.bot_came_back_up ? 'var(--green)' : '#FEE75C', flexShrink: 0 }}>
                    {d.bot_came_back_up ? '✅' : '⚠️ ongoing'}
                  </span>
                </div>
              ))}
            </div>
          </>)}
        </>}

        {view === 'servers' && <>
          {card(<>
            {/* Header + sort controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, color: theme.text, flex: 1 }}>🌐 All Servers ({allGuilds.length})</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {([
                  { id: 'members_desc', label: '👥 Most' },
                  { id: 'members_asc',  label: '👥 Least' },
                  { id: 'created_desc', label: '🕐 Newest' },
                  { id: 'created_asc',  label: '🕐 Oldest' },
                  { id: 'name_asc',     label: 'A→Z' },
                  { id: 'name_desc',    label: 'Z→A' },
                  { id: 'backed_up',    label: '💾 Backed Up' },
                ] as { id: typeof serverSort; label: string }[]).map(opt => (
                  <button key={opt.id} onClick={() => setServerSort(opt.id)} style={{
                    padding: '4px 9px', borderRadius: 6, border: `1px solid ${serverSort === opt.id ? '#5865F2' : theme.border}`,
                    background: serverSort === opt.id ? 'rgba(88,101,242,0.15)' : 'transparent',
                    color: serverSort === opt.id ? '#5865F2' : theme.muted,
                    fontSize: 11, cursor: 'pointer', fontWeight: serverSort === opt.id ? 700 : 400,
                    transition: 'all 0.15s',
                  }}>{opt.label}</button>
                ))}
              </div>
            </div>
            <input
              type="text"
              placeholder="🔍 Search servers by name or ID…"
              value={serverSearch}
              onChange={e => setServerSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: `1px solid ${theme.border2}`, background: 'var(--input-bg)', color: theme.text, fontSize: 13, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />

            {allGuilds.length === 0 && <div style={{ color: theme.muted, fontSize: 13 }}>No live guild data yet. Hit Refresh or check back after bot restart.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...allGuilds].filter(g => {
                if (!serverSearch.trim()) return true;
                const q = serverSearch.toLowerCase();
                return g.name.toLowerCase().includes(q) || g.id.includes(q);
              }).sort((a, b) => {
                if (serverSort === 'members_desc') return b.member_count - a.member_count;
                if (serverSort === 'members_asc')  return a.member_count - b.member_count;
                if (serverSort === 'created_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (serverSort === 'created_asc')  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                if (serverSort === 'name_asc')     return a.name.localeCompare(b.name);
                if (serverSort === 'name_desc')    return b.name.localeCompare(a.name);
                if (serverSort === 'backed_up')    return (backupOwners[b.id] ? 1 : 0) - (backupOwners[a.id] ? 1 : 0);
                return 0;
              }).map(g => {
                const isOpen = selectedServer === g.id;
                const hasBackup = !!(backupInv[g.id]?.length);
                const ownerInfo = resolveUser(g.owner_id);
                const shared = sharedAccess[g.id] ?? [];
                const isBlocked = blGuilds.includes(g.id);
                const isWL = wlGuilds.includes(g.id);
                const saveEst = estimateSaveTime(g);
                const restoreEst = estimateRestoreTime(g);
                return (
                  <div key={g.id} onClick={() => setSelectedServer(isOpen ? null : g.id)}
                    style={{ background: theme.surface2, border: `1px solid ${isOpen ? '#5865F2' : theme.border}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                    {/* Row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>
                      {g.icon_url
                        ? <img src={g.icon_url} style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                        : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(88,101,242,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, color: theme.muted }}>?</div>
                      }
                      <span style={{ fontWeight: 700, color: theme.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                      {isBlocked && <span style={{ fontSize: 10, background: 'rgba(237,66,69,0.15)', color: '#ED4245', border: '1px solid rgba(237,66,69,0.3)', borderRadius: 4, padding: '1px 5px' }}>🚫 Blocked</span>}
                      {isWL && <span style={{ fontSize: 10, background: 'rgba(87,242,135,0.12)', color: 'var(--green)', border: '1px solid rgba(87,242,135,0.3)', borderRadius: 4, padding: '1px 5px' }}>✅ WL</span>}
                      {g.boost_level > 0 && <span style={{ fontSize: 11, color: '#EB459E' }}>✨ L{g.boost_level}</span>}
                      <span style={{ color: theme.muted, fontSize: 12 }}>👥 {g.member_count.toLocaleString()}</span>
                      <span style={{ fontSize: 10, color: hasBackup ? 'var(--green)' : theme.muted, padding: '1px 5px', borderRadius: 4, background: hasBackup ? 'rgba(87,242,135,0.1)' : 'transparent', border: `1px solid ${hasBackup ? 'rgba(87,242,135,0.25)' : 'transparent'}` }}>
                        {hasBackup ? '💾' : '--'}
                      </span>
                      <span style={{ color: theme.muted, fontSize: 11, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                    </div>
                    {/* Expanded detail */}
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${theme.border}` }}>
                        {(saveEst || restoreEst) && (
                          <div style={{ display: 'flex', gap: 16, padding: '8px 0 4px', fontSize: 11, color: theme.muted }}>
                            {saveEst && <span>⏱ Est. save: <span style={{ color: '#5865F2', fontWeight: 600 }}>{saveEst}</span></span>}
                            {restoreEst && <span>🔄 Est. restore: <span style={{ color: '#EB459E', fontWeight: 600 }}>{restoreEst}</span></span>}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, marginBottom: 10 }}>
                          {[
                            { label: 'Members',  value: g.member_count.toLocaleString() },
                            { label: 'Channels', value: g.channel_count },
                            { label: 'Roles',    value: g.role_count },
                            { label: 'Boosts',   value: `${g.boost_count} (L${g.boost_level})` },
                            { label: 'Created',  value: new Date(g.created_at).toLocaleDateString() },
                          ].map(item => (
                            <div key={item.label} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 7, padding: '8px 12px', minWidth: 90 }}>
                              <div style={{ fontSize: 17, fontWeight: 800, color: '#5865F2', fontFamily: 'monospace' }}>{item.value}</div>
                              <div style={{ fontSize: 10, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{item.label}</div>
                            </div>
                          ))}
                        </div>
                        {g.description && <div style={{ fontSize: 12, color: theme.muted, marginBottom: 8, fontStyle: 'italic' }}>"{g.description}"</div>}
                        <div style={{ fontSize: 12, color: theme.muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          Owner:
                          {ownerInfo.avatar && <img src={ownerInfo.avatar} style={{ width: 16, height: 16, borderRadius: '50%' }} />}
                          <span style={{ color: theme.text, fontWeight: 600 }}>{ownerInfo.label}</span>
                          {ownerInfo.sub && <span style={{ color: theme.muted }}>({ownerInfo.sub})</span>}
                          <code style={{ color: theme.muted, fontSize: 10 }}>{g.owner_id}</code>
                        </div>
                        {shared.length > 0 && (
                          <div style={{ fontSize: 12, color: theme.muted, marginBottom: 10 }}>
                            🔗 Backup shared with: {shared.map(uid => {
                              const u = resolveUser(uid);
                              return <span key={uid} style={{ color: '#5865F2', marginRight: 6 }}>{u.label}</span>;
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {['#$info', '#$save', '#$backups', '#$verifybackup'].map(cmd => (
                            <code
                              key={cmd}
                              onClick={e => { e.stopPropagation(); copyId(`${cmd} ${g.id}`); }}
                              style={{ background: copiedId === `${cmd} ${g.id}` ? 'rgba(87,242,135,0.15)' : 'rgba(88,101,242,0.1)', color: copiedId === `${cmd} ${g.id}` ? 'var(--green)' : '#5865F2', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}
                            >{copiedId === `${cmd} ${g.id}` ? '✓ copied' : `${cmd} ${g.id}`}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>)}
        </>}

        {view === 'backups' && <>
          {card(<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: theme.text, flex: 1 }}>
                {(() => {
                  const totalBackups = backupServerIds.reduce((n, sid) => n + (backupInv[sid]?.length ?? 0), 0);
                  return `\u{1F4BE} Backup Registry \u2014 ${backupServerIds.length} server${backupServerIds.length !== 1 ? 's' : ''}, ${totalBackups} backup${totalBackups !== 1 ? 's' : ''}`;
                })()}
              </div>
              <button
                onClick={exportInventory}
                style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.muted, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
              >⬇ Export JSON</button>
            </div>
            {!liveData && <div style={{ color: theme.muted, fontSize: 13 }}>Waiting for data &mdash; hit Refresh.</div>}
            {liveData && backupServerIds.length === 0 && (
              <div style={{ color: theme.muted, fontSize: 13 }}>No backups found in the storage forum. Run <code style={{ color: '#5865F2' }}>#$save &lt;server_id&gt;</code> to create one.</div>
            )}
            {backupServerIds.length > 0 && (
              <input
                type="text"
                placeholder="🔍 Search by server name or ID…"
                value={backupSearch}
                onChange={e => setBackupSearch(e.target.value)}
                style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: `1px solid ${theme.border2}`, background: 'var(--input-bg)', color: theme.text, fontSize: 13, outline: 'none', marginBottom: 4, boxSizing: 'border-box' }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {backupServerIds.filter(sid => {
                if (!backupSearch.trim()) return true;
                const q = backupSearch.toLowerCase();
                return sid.includes(q) || (guildSnap[sid]?.name ?? '').toLowerCase().includes(q);
              }).map(sid => {
                const g          = guildSnap[sid];
                const rawOwnerId = String(backupOwners[sid] ?? '');
                const ownerInfo  = rawOwnerId && rawOwnerId !== 'undefined' ? resolveUser(rawOwnerId) : null;
                const shared     = (sharedAccess[sid] ?? []).map(String);
                const entries    = backupInv[sid] ?? [];
                const isOpen     = selectedServer === sid;
                const days       = daysSinceBackup(sid);
                const stale      = days !== null && days > 7;
                const saveEst    = estimateSaveTime(g);
                const restoreEst = estimateRestoreTime(g);
                return (
                  <div key={sid} style={{ border: `1px solid ${isOpen ? '#5865F2' : stale ? 'rgba(254,231,92,0.4)' : theme.border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                    <div onClick={() => setSelectedServer(isOpen ? null : sid)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: isOpen ? 'rgba(88,101,242,0.06)' : theme.surface2 }}>
                      {g?.icon_url
                        ? <img src={g.icon_url} style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0 }} />
                        : <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(88,101,242,0.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: theme.muted }}>?</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g?.name ?? <span style={{ color: theme.muted, fontStyle: 'italic' }}>Unknown server</span>}
                        </div>
                        <span
                          onClick={e => { e.stopPropagation(); copyId(sid); }}
                          title="Copy server ID"
                          style={{ fontSize: 10, color: copiedId === sid ? 'var(--green)' : theme.muted, fontFamily: 'monospace', cursor: 'pointer', userSelect: 'none' }}
                        >{copiedId === sid ? '✓ copied' : sid}</span>
                      </div>
                      {ownerInfo && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, flexShrink: 0 }}>
                          {ownerInfo.avatar && <img src={ownerInfo.avatar} style={{ width: 15, height: 15, borderRadius: '50%' }} />}
                          <span style={{ color: theme.muted }}>Owner: <span style={{ color: '#5865F2' }}>{ownerInfo.label}</span></span>
                        </div>
                      )}
                      {g && <span style={{ color: theme.muted, fontSize: 11, flexShrink: 0 }}>&#128101; {g.member_count.toLocaleString()}</span>}
                      {(() => {
                        const totalKb = entries.reduce((sum: number, b: any) => sum + (b.size_kb ?? 0), 0);
                        if (!totalKb) return null;
                        const display = totalKb >= 1024 ? `${(totalKb / 1024).toFixed(1)} MB` : `${totalKb} KB`;
                        return <span style={{ color: theme.muted, fontSize: 11, flexShrink: 0 }}>💿 {display}</span>;
                      })()}
                      {stale && <span style={{ fontSize: 10, color: '#FEE75C', background: 'rgba(254,231,92,0.1)', border: '1px solid rgba(254,231,92,0.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>⚠️ {days}d ago</span>}
                      <span style={{ background: 'rgba(88,101,242,0.12)', color: '#5865F2', fontSize: 11, padding: '2px 7px', borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>
                        {entries.length} backup{entries.length !== 1 ? 's' : ''}
                      </span>
                      {shared.length > 0 && (
                        <span style={{ background: 'rgba(87,242,135,0.1)', color: 'var(--green)', fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(87,242,135,0.3)', flexShrink: 0 }}>
                          &#128279; {shared.length}
                        </span>
                      )}
                      <span style={{ color: theme.muted, fontSize: 11, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>&#9658;</span>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${theme.border}` }}>
                        {/* Estimated times */}
                        {(saveEst || restoreEst) && (
                          <div style={{ display: 'flex', gap: 16, padding: '8px 14px', background: 'rgba(88,101,242,0.04)', fontSize: 11, color: theme.muted, borderBottom: `1px solid ${theme.border}` }}>
                            {saveEst && <span>⏱ Est. save: <span style={{ color: '#5865F2', fontWeight: 600 }}>{saveEst}</span></span>}
                            {restoreEst && <span>🔄 Est. restore: <span style={{ color: '#EB459E', fontWeight: 600 }}>{restoreEst}</span></span>}
                            {g && <span style={{ color: theme.muted }}>({g.member_count.toLocaleString()} members, {g.role_count} roles, {g.channel_count} channels)</span>}
                          </div>
                        )}
                        {entries.map((b, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 12, borderBottom: i < entries.length - 1 ? `1px solid ${theme.border}` : 'none', background: theme.surface }}>
                            <span style={{ color: theme.muted, fontFamily: 'monospace', fontSize: 11, flexShrink: 0, minWidth: 160 }}>{b.timestamp_str}</span>
                            <code style={{ color: theme.muted, fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.thread_name}</code>
                            {i === 0 && <span style={{ fontSize: 10, color: 'var(--green)', background: 'rgba(87,242,135,0.1)', border: '1px solid rgba(87,242,135,0.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>latest</span>}
                            <span style={{ color: theme.muted, fontSize: 11, flexShrink: 0 }}>
                              {b.size_kb != null ? (b.size_kb >= 1024 ? `${(b.size_kb / 1024).toFixed(1)} MB` : `${b.size_kb} KB`) : '--'}
                            </span>
                            {b.encrypted && (
                              <span style={{ background: 'rgba(254,231,92,0.15)', color: '#FEE75C', fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(254,231,92,0.3)', flexShrink: 0 }}>&#128274; ENC</span>
                            )}
                            <span style={{ color: theme.muted, fontSize: 10, flexShrink: 0 }}>#{entries.length - i}</span>
                            <button
                              onClick={e => { e.stopPropagation(); copyId(`#$delbackup ${sid} ${entries.length - i}`); }}
                              title="Copy delete command"
                              style={{ padding: '2px 7px', borderRadius: 4, border: `1px solid rgba(237,66,69,0.3)`, background: 'rgba(237,66,69,0.08)', color: '#ED4245', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
                            >{copiedId === `#$delbackup ${sid} ${entries.length - i}` ? '✓ copied' : '📋 copy del cmd'}</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>)}
          {card(<>
            <div style={{ fontWeight: 700, marginBottom: 14, color: theme.text }}>⏰ Autobackup Schedules ({Object.keys(autobackupSchedules).length})</div>
            {Object.keys(autobackupSchedules).length === 0 && (
              <div style={{ color: theme.muted, fontSize: 13 }}>No autobackup schedules set. Use <code style={{ color: '#5865F2' }}>#$autobackup {'<server_id> <hours>'}</code> to create one.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(autobackupSchedules).map(([sid, sched]) => {
                const g = guildSnap[sid];
                const intervalSecs = sched.interval_hours * 3600;
                const nowSecs = Date.now() / 1000;
                const midnight = nowSecs - (nowSecs % 86400);
                const slotsPassed = Math.floor((nowSecs - midnight) / intervalSecs);
                const nextRun = midnight + (slotsPassed + 1) * intervalSecs;
                const waitSecs = Math.max(0, nextRun - nowSecs);
                const waitStr = waitSecs < 60 ? `${Math.round(waitSecs)}s`
                  : waitSecs < 3600 ? `${Math.floor(waitSecs/60)}m ${Math.round(waitSecs%60)}s`
                  : `${Math.floor(waitSecs/3600)}h ${Math.floor((waitSecs%3600)/60)}m`;
                const lastTs = sched.last_run_ts;
                const fmtNames: Record<number,string> = {1:'V1',2:'V2',3:'V3',4:'V4 gzip',5:'V5 lzma'};
                return (
                  <div key={sid} style={{ background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    {g?.icon_url
                      ? <img src={g.icon_url} style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
                      : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(235,69,158,0.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⏰</div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: theme.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g?.name ?? <span style={{ color: theme.muted, fontStyle: 'italic' }}>Unknown server</span>}
                      </div>
                      <div style={{ fontSize: 11, color: theme.muted, fontFamily: 'monospace' }}>{sid}</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>last: {lastTs ? new Date(lastTs * 1000).toUTCString().replace(' GMT','') : 'never'}</span>
                        {sched.ch_bl && sched.ch_bl.length > 0 && <span>blacklist: {sched.ch_bl.join(', ')}</span>}
                        {sched.encrypt_password && <span style={{ color: '#FEE75C' }}>🔒 encrypted</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span style={{ background: 'rgba(235,69,158,0.12)', color: '#EB459E', fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                        every {sched.interval_hours}h
                      </span>
                      <span style={{ fontSize: 11, color: theme.muted }}>next in {waitStr}</span>
                      <span style={{ fontSize: 10, color: theme.muted }}>{fmtNames[sched.fmt_v ?? 5]} • members: {sched.save_mb === false ? 'no' : 'yes'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>)}
          {card(<>
            <div style={{ fontWeight: 700, marginBottom: 10, color: theme.text, fontSize: 13 }}>&#128269; Quick Diff</div>
            <div style={{ color: theme.muted, fontSize: 12 }}>
              Run <code style={{ background: 'rgba(88,101,242,0.1)', color: '#5865F2', padding: '1px 6px', borderRadius: 4 }}>#$diff {'<server_id> <n1> <n2>'}</code> in Discord to compare any two backups side by side.
            </div>
          </>)}
        </>}

        {view === 'access' && <>
          {card(<>
            <div style={{ fontWeight: 700, marginBottom: 14, color: theme.text }}>🔐 Access Control ({accessList.length})</div>
            {accessList.length === 0 && <div style={{ color: theme.muted, fontSize: 13 }}>No admins or managers configured.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {accessList.map((a, i) => {
                const u = resolveUser(a.id);
                const roleColor = a.role === 'Owner' ? '#ED4245' : a.role === 'Manager' ? '#5865F2' : 'var(--green)';
                const roleBg    = a.role === 'Owner' ? 'rgba(237,66,69,0.12)' : a.role === 'Manager' ? 'rgba(88,101,242,0.12)' : 'rgba(87,242,135,0.12)';
                return (
                  <div key={i} style={{ background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                    {u.avatar
                      ? <img src={u.avatar} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                      : <div style={{ width: 32, height: 32, borderRadius: '50%', background: roleBg, border: `2px solid ${roleColor}55`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
                          {u.label[0]?.toUpperCase() ?? '?'}
                        </div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: theme.text }}>{u.label}</div>
                      {u.sub && <div style={{ fontSize: 11, color: theme.muted }}>@{u.sub}</div>}
                      <div style={{ fontSize: 10, color: theme.muted, fontFamily: 'monospace' }}>{a.id}</div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: roleBg, color: roleColor, border: `1px solid ${roleColor}44`, flexShrink: 0 }}>
                      {a.role}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(88,101,242,0.05)', borderRadius: 8, fontSize: 12, color: theme.muted }}>
              Use <code style={{ color: '#5865F2' }}>#$addadmin / #$removeadmin</code> to manage admins · <code style={{ color: '#5865F2' }}>#$sharebackup</code> to grant per-server access
            </div>
          </>)}
          {(wlGuilds.length > 0 || wlUsers.length > 0 || blGuilds.length > 0 || blUsers.length > 0) && card(<>
            <div style={{ fontWeight: 700, marginBottom: 12, color: theme.text }}>📋 Server & User Lists</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {wlGuilds.map(id => { const g = guildSnap[id]; return <div key={id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--green)', padding: '3px 0' }}>✅ WL Guild: <span style={{ color: theme.text }}>{g?.name ?? id}</span> <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code></div>; })}
              {wlUsers.map(id => { const u = resolveUser(id); return <div key={id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--green)', padding: '3px 0' }}>✅ WL User: <span style={{ color: theme.text }}>{u.label}</span> <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code></div>; })}
              {blGuilds.map(id => { const g = guildSnap[id]; return <div key={id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', color: '#ED4245', padding: '3px 0' }}>🚫 Blocked Guild: <span style={{ color: theme.text }}>{g?.name ?? id}</span> <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code></div>; })}
              {blUsers.map(id => { const u = resolveUser(id); return <div key={id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', color: '#ED4245', padding: '3px 0' }}>🚫 Blocked User: <span style={{ color: theme.text }}>{u.label}</span> <code style={{ color: theme.muted, fontSize: 10 }}>{id}</code></div>; })}
            </div>
          </>)}
        </>}

        {view === 'logs' && <>
          {card(<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: theme.text, flex: 1 }}>
                ❌ Error Log ({(liveData?.error_log ?? []).length})
              </div>
              {(liveData?.error_log ?? []).length > 0 && (
                <input
                  type="text"
                  placeholder="🔍 Search errors…"
                  value={errorSearch}
                  onChange={e => setErrorSearch(e.target.value)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${theme.border2}`, background: 'var(--input-bg)', color: theme.text, fontSize: 12, outline: 'none', width: 200 }}
                />
              )}
            </div>
            {(liveData?.error_log ?? []).length === 0 && (
              <div style={{ color: theme.muted, fontSize: 13 }}>No errors recorded. 🟢</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[...(liveData?.error_log ?? [])].reverse().filter((e: any) => {
                if (!errorSearch.trim()) return true;
                const q = errorSearch.toLowerCase();
                return (e.cmd ?? '').toLowerCase().includes(q)
                  || (e.error ?? '').toLowerCase().includes(q)
                  || (e.user ?? '').toLowerCase().includes(q)
                  || String(e.user_id ?? '').includes(q);
              }).map((e: any, i: number, arr: any[]) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: i < arr.length - 1 ? `1px solid ${theme.border}` : 'none', fontSize: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ color: theme.muted, fontFamily: 'monospace', fontSize: 10, flexShrink: 0, width: 140 }}>{e.ts ? new Date(e.ts).toLocaleString() : '—'}</span>
                  <span style={{ color: '#5865F2', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>#{e.cmd ?? '?'}</span>
                  {e.args && <span style={{ color: theme.muted, fontSize: 11, flexShrink: 0 }}>{e.args}</span>}
                  <span style={{ color: '#ED4245', flex: 1, minWidth: 200 }}>{e.error ?? 'Unknown error'}</span>
                  <span style={{ color: theme.muted, fontSize: 10, flexShrink: 0 }}>{e.user ?? e.user_id ?? '—'}</span>
                </div>
              ))}
            </div>
          </>)}
          {card(<>
            <div style={{ fontWeight: 700, marginBottom: 14, color: theme.text }}>📋 Downtime Log</div>
            {downtimeEvents.length === 0 && (
              <div style={{ color: theme.muted, fontSize: 13 }}>No downtime events recorded. 🟢</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[...downtimeEvents].reverse().map((d, i) => (
                <div key={d.id ?? i} style={{ display: 'flex', gap: 14, padding: '8px 0', borderBottom: i < downtimeEvents.length - 1 ? `1px solid ${theme.border}` : 'none', fontSize: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: theme.muted, fontFamily: 'monospace', flexShrink: 0, width: 170 }}>{d.server_went_down_approx}</span>
                  <span style={{ color: '#ED4245', flex: 1 }}>{d.reason}</span>
                  <span style={{ color: theme.muted, flexShrink: 0 }}>{d.duration_human}</span>
                  <span style={{ flexShrink: 0, color: d.bot_came_back_up ? 'var(--green)' : '#FEE75C' }}>
                    {d.bot_came_back_up ? '✅ Resolved' : '⚠️ Ongoing'}
                  </span>
                </div>
              ))}
            </div>
          </>)}
        </>}

        {view === 'quick_answers' && <>
          {card(<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontWeight: 700, color: theme.text, flex: 1 }}>💬 Quick Answers ({FAQ.length})</div>
            </div>
            <div style={{ fontSize: 12, color: theme.muted, marginBottom: 10 }}>Copy-paste friendly answers for common support questions.</div>
            <input
              type="text"
              placeholder="🔍 Search questions…"
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: `1px solid ${theme.border2}`, background: 'var(--input-bg)', color: theme.text, fontSize: 13, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
              {FAQ.filter(item => {
                if (!quickSearch.trim()) return true;
                const q = quickSearch.toLowerCase();
                return item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q);
              }).map((item, i) => (
                <QuickAnswerRow key={i} item={item} theme={theme} />
              ))}
            </div>
          </>)}
        </>}

      </div>
    </div>
  );
}

function TryItTab({ darkMode, theme }: { darkMode: boolean; theme: Record<string, string> }) {
  const [selected, setSelected] = useState(0);
  const [step, setStep] = useState(-1);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [visibleTurns, setVisibleTurns] = useState<number[]>([]);
  const selectedRef = useRef(0);

  const ex = TRY_IT_EXAMPLES[selected];
  const convo = ex.conversation;
  const TIME = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    selectedRef.current = selected;
    setStep(-1); setTyped(''); setTyping(false); setVisibleTurns([]);
  }, [selected]);

  const run = () => {
    if (typing) return;
    const snap = selected;
    setStep(-1); setTyped(''); setVisibleTurns([]);
    setTyping(true);
    let i = 0;
    const fullCmd = TRY_IT_EXAMPLES[snap].cmd;
    const iv = setInterval(() => {
      i++;
      setTyped(fullCmd.slice(0, i));
      if (i >= fullCmd.length) {
        clearInterval(iv);
        setTimeout(() => {
          setTyping(false);
          playFrom(0, snap);
        }, 500);
      }
    }, 80);
  };

  const playFrom = (idx: number, snap: number) => {
    const convo = TRY_IT_EXAMPLES[snap]?.conversation;
    if (!convo || idx >= convo.length) { setStep(convo?.length ?? 0); return; }
    if (selectedRef.current !== snap) return; // aborted, user switched
    setStep(idx);
    setVisibleTurns(prev => [...prev, idx]);
    const turn = convo[idx];
    const delay = turn.from === 'user' ? 700 : 1100;
    setTimeout(() => playFrom(idx + 1, snap), delay);
  };

  const isRunning = typing || (step >= 0 && step < convo.length);
  const isDone = step >= convo.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.5, color: theme.muted, fontFamily: 'monospace' }}>
          Pick a command to preview
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TRY_IT_EXAMPLES.map((e, i) => (
            <button key={i} onClick={() => setSelected(i)} style={{
              padding: '7px 14px', borderRadius: 7,
              border: `1px solid ${i === selected ? '#5865F2' : theme.border}`,
              background: i === selected ? 'rgba(88,101,242,0.15)' : theme.surface2,
              color: i === selected ? '#5865F2' : theme.text,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {e.desc}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: '#0d0f12', border: '1px solid rgba(88,101,242,0.25)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: 'rgba(88,101,242,0.1)', borderBottom: '1px solid rgba(88,101,242,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#72767d' }}>Discord, #bot-commands</span>
          <button onClick={run} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none',
            background: isRunning ? 'rgba(88,101,242,0.3)' : '#5865F2',
            color: '#fff', fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, cursor: isRunning ? 'default' : 'pointer',
            fontWeight: 700, transition: 'background 0.2s',
          }}>
            {typing ? 'typing...' : isRunning ? 'running...' : isDone ? '▶ run again' : '▶ run'}
          </button>
        </div>

        <div style={{ padding: '16px 20px', minHeight: 200, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Initial user command */}
          {typed.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🥔</div>
              <div>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>potato</span>
                <span style={{ color: '#72767d', fontSize: 11, marginLeft: 8 }}>{TIME}</span>
                <div style={{ color: '#dcddde', marginTop: 2 }}>{typed}{typing && <span style={{ opacity: 0.6 }}>|</span>}</div>
              </div>
            </div>
          )}

          {/* Conversation turns */}
          {visibleTurns.map((idx) => {
            const turn = convo[idx];
            if (!turn) return null;
            if (turn.from === 'bot') return (
              <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingLeft: 4, borderLeft: '3px solid #5865F2' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#5865F2,#EB459E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>💾</div>
                <div>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>Server Save/Load</span>
                  <span style={{ background: '#5865F2', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, marginLeft: 6, fontWeight: 700 }}>APP</span>
                  <span style={{ color: '#72767d', fontSize: 11, marginLeft: 8 }}>{TIME}</span>
                  <div style={{ marginTop: 4 }}>
                    {(turn as any).lines.map((line: string, i: number) => (
                      <div key={i} style={{ color: line === '' ? undefined : '#dcddde', minHeight: line === '' ? 8 : undefined }}>
                        {line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🥔</div>
                <div>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>potato</span>
                  <span style={{ color: '#72767d', fontSize: 11, marginLeft: 8 }}>{TIME}</span>
                  <div style={{ color: '#dcddde', marginTop: 2 }}>{(turn as any).text}</div>
                </div>
              </div>
            );
          })}

          {step === -1 && typed.length === 0 && (
            <div style={{ color: '#4f545c', fontSize: 12, textAlign: 'center', paddingTop: 60 }}>
              Press ▶ run to preview this command
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [statsStarted, setStatsStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('commands');
  const [search, setSearch] = useState('');
  const [faqSearch, setFaqSearch] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [openService, setOpenService] = useState<number | null>(null);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useMemo(() => async () => {
    try {
      const res = await fetch(DATA_URL, {
        headers: { 'Accept': 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (res.status === 403 || res.status === 429) {
        // Rate limited — keep existing data, just update the timestamp
        setLastSynced(Date.now());
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      const decoded = atob(envelope.content.replace(/\n/g, ''));
      const json = JSON.parse(decoded);
      setLiveData(json);
      setLastSynced(Date.now());
    } catch {
      // Network error etc — preserve existing data, don't wipe it
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('darkMode') !== 'false'; } catch { return true; }
  });
  const [seenVersion, setSeenVersion] = useState<string>(
    () => localStorage.getItem('seenVersion') || ''
  );
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });
  const [showScrollTop, setShowScrollTop] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const downtimeLog: DowntimeEntry[] = liveData?.downtime_log ?? [];
  const online: boolean | null = liveData
    ? isBotOnline(liveData.heartbeat, lastSynced)
    : null;
  const maintenance = liveData?.maintenance ?? false;
  const pingMs = liveData?.ping_ms ?? null;
  const latestVersion = CHANGELOG[0]?.version ?? null;

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    try { localStorage.setItem('darkMode', String(next)); } catch {}
  };

  const theme = {
    bg: darkMode ? '#0d0f12' : '#f2f3f5',
    surface: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)',
    surface2: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)',
    border: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)',
    border2: darkMode ? 'rgba(88,101,242,0.3)' : 'rgba(88,101,242,0.4)',
    text: darkMode ? '#dcddde' : '#1a1b1e',
    muted: darkMode ? '#72767d' : '#6d6f78',
    headerBg: darkMode ? 'linear-gradient(180deg, #1a1d2e 0%, #0d0f12 100%)' : 'linear-gradient(180deg, #e8eaf6 0%, #f2f3f5 100%)',
    headerBorder: darkMode ? 'rgba(88,101,242,0.2)' : 'rgba(88,101,242,0.3)',
    inputBg: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    tabActiveBg: darkMode ? '#5865F2' : '#5865F2',
    tabBg: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)',
  };
  const hasNewChangelog = latestVersion && seenVersion !== latestVersion;

  useEffect(() => {
    if (activeTab === 'changelog' && hasNewChangelog) {
      setSeenVersion(latestVersion!);
      localStorage.setItem('seenVersion', latestVersion!);
    }
  }, [activeTab, hasNewChangelog, latestVersion]);

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceUpdate((n) => n + 1), 1_000);
    return () => clearInterval(iv);
  }, []);

  const syncAgo =
    lastSynced !== null ? Math.floor((Date.now() - lastSynced) / 1000) : null;

  const syncLabel =
    syncAgo === null
      ? null
      : syncAgo < 10
      ? 'just now'
      : syncAgo < 60
      ? `${syncAgo}s ago`
      : `${Math.floor(syncAgo / 60)}m ago`;

  const copyCmd = (cmd: Cmd) => {
    const text = cmd.args ? `#$${cmd.name} ${cmd.args}` : `#$${cmd.name}`;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedCmd(text);
        showToast(`Copied ${text}`);
        setTimeout(() => setCopiedCmd(null), 1800);
      })
      .catch(() => {
      });
  };

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setStatsStarted(true);
      },
      { threshold: 0.2 }
    );
    if (statsRef.current) obs.observe(statsRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        activeTab === 'commands' &&
        document.activeElement !== searchRef.current
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab]);

  useEffect(() => {
    const handler = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, visible: true });
    toastTimer.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      2000
    );
  };

  useEffect(() => {
    document.title = 'Discord Backup Bot';
    const setMeta = (property: string, content: string, isName = false) => {
      const attr = isName ? 'name' : 'property';
      let el = document.querySelector(
        `meta[${attr}="${property}"]`
      ) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, property);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    setMeta('og:title', 'Discord Backup Bot');
    setMeta(
      'og:description',
      'Back up, restore, and protect your Discord server. Roles, channels, members, emojis, and more. Prefix: #$'
    );
    setMeta('og:color', '#5865F2');
    setMeta('og:type', 'website');
    setMeta('theme-color', '#5865F2', true);
    setMeta(
      'description',
      'Back up, restore, and protect your Discord server. Roles, channels, members, emojis, and more. Prefix: #$',
      true
    );
  }, []);

  const statusServices = useMemo(
    () => [
      {
        name: 'Main Bot',
        status:
          online === null ? 'Checking...' : online ? 'Operational' : 'Offline',
        color: online === null ? '#72767d' : online ? 'var(--green)' : '#ED4245',
        ping: pingMs !== null ? `${pingMs}ms` : null,
      },
      { name: 'Helper Bots', status: 'Operational', color: 'var(--green)', ping: null },
      { name: 'Backup Storage', status: 'Operational', color: 'var(--green)', ping: null },
      { name: 'Uptime Monitor', status: 'Operational', color: 'var(--green)', ping: null },
    ],
    [online, pingMs]
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: '0 0 0',
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        :root {
          --t: ${darkMode ? '#dcddde' : '#1a1b1e'};
          --muted: ${darkMode ? '#72767d' : '#55575e'};
          --faint: ${darkMode ? '#4f545c' : '#6b6e77'};
          --surface: ${darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)'};
          --surface2: ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'};
          --border: ${darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)'};
          --border2: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.14)'};
          --input-bg: ${darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
          --green: ${darkMode ? '#57F287' : '#1a8a3c'};
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${darkMode ? 'rgba(88,101,242,0.5)' : 'rgba(88,101,242,0.4)'}; }
      `}</style>

      <Toast message={toast.message} visible={toast.visible} />

      {/* Header */}
      <div
        style={{
          background: theme.headerBg,
          borderBottom: `1px solid ${theme.headerBorder}`,
          padding: '40px 0 32px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(88,101,242,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(88,101,242,0.07) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            WebkitMaskImage:
              'radial-gradient(ellipse 80% 100% at 50% 0%, black, transparent)',
            maskImage:
              'radial-gradient(ellipse 80% 100% at 50% 0%, black, transparent)',
          }}
        />
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background:
                online === null
                  ? 'rgba(114,118,125,0.15)'
                  : online
                  ? 'rgba(88,101,242,0.15)'
                  : 'rgba(237,66,69,0.15)',
              border: `1px solid ${
                online === null
                  ? 'rgba(114,118,125,0.4)'
                  : online
                  ? 'rgba(88,101,242,0.4)'
                  : 'rgba(237,66,69,0.4)'
              }`,
              borderRadius: 20,
              padding: '4px 12px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color:
                online === null ? '#72767d' : online ? '#5865F2' : '#ED4245',
              letterSpacing: 1,
            }}
          >
            {online === null ? (
              '◌ LOADING'
            ) : online ? (
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <PingDot color="#5865F2" size={8} />
                ONLINE
              </span>
            ) : (
              '○ OFFLINE'
            )}{' '}
            &nbsp;·&nbsp; {latestVersion ?? 'v?'}
          </div>
          </div>
          <h1
            key={darkMode ? 'dark' : 'light'}
            style={{
              margin: 0,
              fontSize: 42,
              fontWeight: 800,
              fontFamily: "'JetBrains Mono', monospace",
              background: darkMode
                ? 'linear-gradient(135deg, #ffffff 30%, #5865F2)'
                : 'linear-gradient(135deg, #1a1b1e 30%, #5865F2)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              display: 'inline-block',
              letterSpacing: -2,
            }}
          >
            Discord Backup Bot
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: 'var(--muted)',
              fontSize: 14,
              letterSpacing: 0.5,
            }}
          >
            Server Backup · Restore · Prefix&nbsp;
            <code
              style={{
                background: 'rgba(88,101,242,0.2)',
                color: '#5865F2',
                padding: '1px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
              }}
            >
              #$
            </code>
            &nbsp;·&nbsp; Launched March 1st, 2026
          </p>
          {/* Invite buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              marginTop: 20,
              flexWrap: 'wrap',
            }}
          >
            <a
              href={BOT_INVITE_URL}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: '#5865F2',
                color: '#fff',
                borderRadius: 8,
                padding: '10px 20px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                fontWeight: 700,
                textDecoration: 'none',
                letterSpacing: 0.3,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.85')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')
              }
            >
              + Add to Server
            </a>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'var(--surface2)',
                color: 'var(--t)',
                borderRadius: 8,
                padding: '10px 20px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                border: '1px solid var(--border2)',
                letterSpacing: 0.3,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background =
                  'var(--surface2)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background =
                  'var(--surface2)')
              }
            >
              Support Server
            </a>
          </div>
          {/* Unverified bot notice */}
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              padding: '5px 12px',
              background: 'rgba(254,231,92,0.07)',
              border: '1px solid rgba(254,231,92,0.25)',
              borderRadius: 20,
              fontSize: 11,
              color: 'var(--muted)',
              fontFamily: 'monospace',
              textDecoration: 'none',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background =
                'rgba(254,231,92,0.13)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background =
                'rgba(254,231,92,0.07)')
            }
          >
            <span style={{ color: '#FEE75C' }}>⚠</span>
            Bot is unverified · limited to 100 servers · join support server if
            the bot is full
          </a>
        </div>
        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 14,
            color: theme.muted,
            transition: 'background 0.2s',
          }}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px' }}>
        {/* Stats */}
        <div
          ref={statsRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            margin: '32px 0',
          }}
        >
          {STATS.map((s, i) => (
            <StatCard key={i} label={s.label} value={s.value} suffix={s.suffix} delay={i} started={statsStarted} />
          ))}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 20,
            background: theme.tabBg,
            borderRadius: 8,
            padding: 4,
            flexWrap: 'wrap',
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); if (t.id === 'uptime') fetchData(); }}
              style={{
                flex: 1,
                padding: '8px 6px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.2,
                background: activeTab === t.id ? '#5865F2' : t.id === 'admin' ? 'rgba(237,66,69,0.1)' : 'transparent',
                color: activeTab === t.id ? '#fff' : t.id === 'admin' ? '#ED4245' : theme.muted,
                transition: 'all 0.2s',
                position: 'relative',
              }}
            >
              {t.label}
              {t.id === 'changelog' && hasNewChangelog && (
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 6,
                    height: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PingDot color="#ED4245" size={6} />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* COMMANDS */}
        {activeTab === 'commands' && (
          <div>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                  fontSize: 14,
                }}
              >
                🔍
              </span>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search commands..."
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 38px',
                  background: theme.inputBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  color: theme.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#5865F2';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border2)';
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: 18,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(COMMANDS).map(([name, data]) => {
                const q = search.toLowerCase().trim();
                const filtered: Cmd[] | undefined = q
                  ? data.cmds.filter(
                      (c) =>
                        c.name.includes(q) || c.desc.toLowerCase().includes(q)
                    )
                  : undefined;
                if (filtered && filtered.length === 0) return null;
                return (
                  <CommandGroup
                    key={name}
                    name={name}
                    data={data}
                    isOpen={
                      openGroup === name ||
                      (!!q && !!filtered && filtered.length > 0)
                    }
                    onToggle={() =>
                      setOpenGroup(openGroup === name ? null : name)
                    }
                    filtered={filtered}
                    copiedCmd={copiedCmd}
                    copyCmd={copyCmd}
                  />
                );
              })}
            </div>
            {search.trim() &&
              Object.entries(COMMANDS).every(
                ([, data]) =>
                  !data.cmds.some(
                    (c) =>
                      c.name.includes(search.toLowerCase()) ||
                      c.desc.toLowerCase().includes(search.toLowerCase())
                  )
              ) && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 0',
                    color: 'var(--muted)',
                    fontFamily: 'monospace',
                    fontSize: 13,
                  }}
                >
                  No commands matching "
                  <span style={{ color: '#5865F2' }}>{search}</span>"
                </div>
              )}
          </div>
        )}

        {/* STATUS */}
        {activeTab === 'uptime' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {maintenance && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 18px',
                  background: 'rgba(254,231,92,0.08)',
                  border: '1px solid rgba(254,231,92,0.35)',
                  borderRadius: 10,
                }}
              >
                <span style={{ fontSize: 16 }}>🔧</span>
                <div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: '#FEE75C',
                      fontSize: 13,
                    }}
                  >
                    Scheduled Maintenance
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                    The bot may be temporarily unavailable. This is expected.
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '16px 20px',
                background:
                  online === null
                    ? 'rgba(114,118,125,0.08)'
                    : online
                    ? 'rgba(87,242,135,0.08)'
                    : 'rgba(237,66,69,0.08)',
                border: `1px solid ${
                  online === null
                    ? 'rgba(114,118,125,0.3)'
                    : online
                    ? 'rgba(87,242,135,0.3)'
                    : 'rgba(237,66,69,0.3)'
                }`,
                borderRadius: 10,
              }}
            >
              <PingDot
                color={
                  online === null ? '#72767d' : online ? 'var(--green)' : '#ED4245'
                }
                size={10}
              />
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    color:
                      online === null
                        ? '#72767d'
                        : online
                        ? 'var(--green)'
                        : '#ED4245',
                    fontFamily: 'monospace',
                    fontSize: 14,
                  }}
                >
                  {online === null
                    ? 'Checking status...'
                    : online
                    ? 'All Systems Operational'
                    : 'Main Bot Offline'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Online since Mar 1, 2026 · {DAYS_LIVE} day
                  {DAYS_LIVE !== 1 ? 's' : ''} running
                  {syncLabel && (
                    <span style={{ marginLeft: 8, color: 'var(--faint)' }}>
                      · synced {syncLabel}
                    </span>
                  )}
                </div>
              </div>
              {/* Days without incident */}
              {(() => {
                const lastIncident =
                  downtimeLog.length > 0
                    ? Math.max(
                        ...downtimeLog.map((e) =>
                          new Date(
                            e.bot_came_back_up || e.server_went_down_approx
                          ).getTime()
                        )
                      )
                    : null;
                const daysClear =
                  lastIncident !== null
                    ? Math.floor((Date.now() - lastIncident) / 86400000)
                    : DAYS_LIVE;
                return (
                  <div
                    style={{
                      marginLeft: 'auto',
                      textAlign: 'right',
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 22,
                        fontWeight: 700,
                        color: 'var(--green)',
                        lineHeight: 1,
                      }}
                    >
                      {daysClear}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        marginTop: 2,
                      }}
                    >
                      days clear
                    </div>
                    {liveData?.heartbeat?.last_seen && (() => {
                      const ms = Date.now() - new Date(liveData.heartbeat.last_seen).getTime();
                      const s = Math.floor(ms / 1000);
                      const rel = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s/60)}m ago` : `${Math.floor(s/3600)}h ago`;
                      return (
                        <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'monospace', marginTop: 4 }}>
                          last ping {rel}
                        </div>
                      );
                    })()}
                    <button
                      onClick={handleRefresh}
                      disabled={refreshing}
                      style={{
                        marginTop: 6,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: refreshing ? 'var(--faint)' : 'var(--muted)',
                        fontSize: 11,
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>↻</span>
                      {refreshing ? 'checking...' : 'check again'}
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* Services as accordions */}
            {statusServices.map((s, si) => {
              const isOpen = openService === si;
              const isMainBot = si === 0 || si === 1; // Main Bot + Helper Bots share the same script
              const log = isMainBot ? downtimeLog : [];
              const pct24  = isMainBot ? calcUptimePct(log, 1)            : 100;
              const pct7   = isMainBot ? calcUptimePct(log, 7)            : 100;
              const pctAll = isMainBot ? calcUptimePct(log, DAYS_MONITORED): 100;
              const getBorderColor = (pct: number) =>
                pct >= 99.9
                  ? (darkMode ? 'rgba(87,242,135,0.35)' : 'rgba(26,138,60,0.35)')
                  : pct >= 95 ? 'rgba(254,231,92,0.35)' : 'rgba(237,66,69,0.35)';
              const getPctColor = (pct: number) =>
                pct >= 99.9 ? 'var(--green)' : pct >= 95 ? '#FEE75C' : '#ED4245';
              return (
                <div key={si} style={{ background: 'var(--surface)', border: `1px solid ${isOpen ? s.color + '55' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                  {/* Row */}
                  <div onClick={() => setOpenService(isOpen ? null : si)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', userSelect: 'none', background: isOpen ? `${s.color}0d` : 'transparent', transition: 'background 0.2s' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--t)' }}>{s.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {s.ping && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{s.ping}</span>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PingDot color={s.color} size={7} />
                        <span style={{ fontSize: 12, color: s.color, fontFamily: 'monospace' }}>{s.status}</span>
                      </div>
                      <span style={{ color: 'var(--muted)', fontSize: 11, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s' }}>&#9658;</span>
                    </div>
                  </div>
                  {/* Expanded uptime */}
                  {isOpen && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                      {/* Pct cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, paddingTop: 14, marginBottom: 14 }}>
                        {[
                          { label: 'Last 24h', pct: pct24  },
                          { label: 'Last 7d',  pct: pct7   },
                          { label: `All ${DAYS_MONITORED}d`, pct: pctAll },
                        ].map((u, i) => (
                          <div key={i} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--surface2)', borderRadius: 8, border: `1px solid ${getBorderColor(u.pct)}` }}>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700, color: getPctColor(u.pct) }}>{u.pct}%</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{u.label}</div>
                          </div>
                        ))}
                      </div>
                      {/* Day bars */}
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, fontFamily: 'monospace' }}>
                        Since Feb 20 ({DAYS_MONITORED} days)
                      </div>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                        {Array.from({ length: DAYS_MONITORED }).map((_, i) => {
                          const dayStart = new Date(UPTIME_START);
                          dayStart.setDate(dayStart.getDate() + i);
                          dayStart.setHours(0, 0, 0, 0);
                          const dayEnd = new Date(dayStart);
                          dayEnd.setDate(dayEnd.getDate() + 1);
                          const barBg = getDayGradient(dayStart.getTime(), dayEnd.getTime(), log);
                          const dateStr = dayStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                          const isPreLaunch = dayStart < LAUNCH_DATE;
                          const dayIncidents = log.filter(e => {
                            const t = new Date(e.server_went_down_approx).getTime();
                            const end = t + (e.duration_seconds || 0) * 1000;
                            return t < dayEnd.getTime() && end > dayStart.getTime();
                          });
                          return (
                            <div key={i} style={{ flex: 1, minWidth: 4, position: 'relative' }}
                              onMouseEnter={e => { const tip = (e.currentTarget as HTMLDivElement).querySelector('.bar-tip') as HTMLElement | null; if (tip) tip.style.display = 'block'; }}
                              onMouseLeave={e => { const tip = (e.currentTarget as HTMLDivElement).querySelector('.bar-tip') as HTMLElement | null; if (tip) tip.style.display = 'none'; }}>
                              <div style={{ height: 24, borderRadius: 2, background: barBg }} />
                              <div className="bar-tip" style={{
                                display: 'none', position: 'absolute', bottom: 30,
                                ...(i < 3 ? { left: 0 } : i > DAYS_MONITORED - 4 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' }),
                                background: darkMode ? '#1e2030' : '#ffffff',
                                border: `1px solid ${dayIncidents.length > 0 ? 'rgba(237,66,69,0.4)' : darkMode ? 'rgba(87,242,135,0.3)' : 'rgba(26,138,60,0.3)'}`,
                                borderRadius: 8, padding: '8px 12px', minWidth: 160, maxWidth: 240, zIndex: 100, pointerEvents: 'none',
                                boxShadow: darkMode ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.12)',
                              }}>
                                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', marginBottom: dayIncidents.length > 0 ? 5 : 0 }}>
                                  {dateStr}{isPreLaunch ? ' · pre-launch' : ''}
                                </div>
                                {dayIncidents.length === 0
                                  ? <div style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'monospace' }}>&#10003; Operational</div>
                                  : dayIncidents.map((inc, j) => {
                                      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                                      const fmtOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: tz };
                                      const tzShort = new Date(dayStart).toLocaleDateString([], { timeZoneName: 'short', timeZone: tz }).split(', ')[1] || tz;
                                      const incDown = new Date(inc.server_went_down_approx).getTime();
                                      const incUp   = inc.bot_came_back_up ? new Date(inc.bot_came_back_up).getTime() : incDown + (inc.duration_seconds || 0) * 1000;
                                      const segStart = Math.max(incDown, dayStart.getTime());
                                      const segEnd   = Math.min(incUp, dayEnd.getTime());
                                      const segSecs  = Math.round((segEnd - segStart) / 1000);
                                      const segH = Math.floor(segSecs / 3600);
                                      const segM = Math.floor((segSecs % 3600) / 60);
                                      const fromStr  = new Date(segStart).toLocaleTimeString([], fmtOpts);
                                      const toStr    = new Date(segEnd).toLocaleTimeString([], fmtOpts);
                                      const startsBeforeDay = incDown < dayStart.getTime();
                                      const endsAfterDay    = incUp > dayEnd.getTime() - 1000;
                                      const isAllDay = segStart <= dayStart.getTime() && segEnd >= dayEnd.getTime() - 1000;
                                      return (
                                        <div key={j} style={{ borderTop: j > 0 ? '1px solid var(--border)' : 'none', paddingTop: j > 0 ? 5 : 0, marginTop: j > 0 ? 5 : 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#ED4245', fontWeight: 700 }}>#{inc.id}</span>
                                            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--faint)' }}>{tzShort}</span>
                                          </div>
                                          {isAllDay
                                            ? <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#ED4245', marginBottom: 2 }}>All day</div>
                                            : <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--t)', marginBottom: 2 }}>
                                                <span style={{ color: startsBeforeDay ? '#72767d' : '#ED4245' }}>{startsBeforeDay ? '←' : fromStr}</span>
                                                <span style={{ color: 'var(--faint)' }}> → </span>
                                                <span style={{ color: endsAfterDay ? '#72767d' : 'var(--green)' }}>{endsAfterDay ? '→' : toStr}</span>
                                                <span style={{ color: 'var(--muted)' }}> ({segH > 0 ? `${segH}h ${segM}m` : `${segM}m`} this day)</span>
                                              </div>
                                          }
                                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{inc.reason}</div>
                                        </div>
                                      );
                                    })
                                }
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--faint)', fontFamily: 'monospace' }}>
                        <span>Feb 20</span>
                        <span style={{ color: '#5865F2' }}>Mar 1 launch</span>
                        <span>Today</span>
                      </div>
                      {/* Incident log inline (main bot only) */}
                      {si === 0 && downtimeLog.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'monospace', marginBottom: 8 }}>
                            Incident History ({downtimeLog.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[...downtimeLog].reverse().map(entry => (
                              <div key={entry.id} style={{ padding: '8px 12px', background: 'rgba(237,66,69,0.04)', border: '1px solid rgba(237,66,69,0.15)', borderRadius: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#ED4245' }}>#{entry.id} · {entry.duration_human}</span>
                                  <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'monospace' }}>
                                    {new Date(entry.server_went_down_approx).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{entry.reason}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Standalone incident history at the bottom */}
            {downtimeLog.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  Incident History ({downtimeLog.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[...downtimeLog].reverse().map((entry) => (
                    <div key={entry.id} style={{ padding: '10px 14px', background: 'rgba(237,66,69,0.04)', border: '1px solid rgba(237,66,69,0.15)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#ED4245' }}>
                          #{entry.id} · {entry.duration_human}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'monospace' }}>
                          {new Date(entry.server_went_down_approx).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{entry.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CHANGELOG */}
        {activeTab === 'changelog' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {CHANGELOG.map((entry, i) => (
              <div
                key={i}
                style={{ display: 'flex', gap: 20, paddingBottom: 28 }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 16,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      marginTop: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <PingDot color={entry.color} size={12} />
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: 'var(--surface)',
                    border: `1px solid ${entry.color}44`,
                    borderRadius: 10,
                    padding: '14px 18px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700,
                        color: 'var(--t)',
                        fontSize: 14,
                      }}
                    >
                      {entry.version}
                    </span>
                    <span
                      style={{
                        background: `${entry.color}33`,
                        color: entry.color,
                        borderRadius: 20,
                        padding: '1px 8px',
                        fontSize: 10,
                        fontFamily: 'monospace',
                        fontWeight: 700,
                      }}
                    >
                      {entry.tag}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11,
                        color: 'var(--faint)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {entry.date}
                    </span>
                  </div>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    {entry.changes.map((c, j) => (
                      <div
                        key={j}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          fontSize: 13,
                          color: 'var(--muted)',
                        }}
                      >
                        <span
                          style={{
                            color: entry.color,
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          +
                        </span>
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <div
              style={{
                textAlign: 'center',
                padding: '8px 0 0',
                fontSize: 12,
                color: 'var(--faint)',
                fontFamily: 'monospace',
              }}
            >
              More updates coming soon
            </div>
          </div>
        )}

        {/* FAQ */}
        {activeTab === 'faq' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ position: 'relative', marginBottom: 4 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.muted, fontSize: 14 }}>🔍</span>
              <input
                value={faqSearch}
                onChange={(e) => { setFaqSearch(e.target.value); setOpenFaq(null); }}
                placeholder="Search FAQ..."
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 38px',
                  background: theme.inputBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  color: theme.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            {PUBLIC_FAQ.filter(item =>
              !faqSearch || item.q.toLowerCase().includes(faqSearch.toLowerCase()) || item.a.toLowerCase().includes(faqSearch.toLowerCase())
            ).map((item, i) => (
              <FaqItem
                key={i}
                item={item}
                isOpen={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
            <div
              style={{
                marginTop: 8,
                padding: '14px 18px',
                background: 'rgba(88,101,242,0.06)',
                border: '1px solid rgba(88,101,242,0.2)',
                borderRadius: 10,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              Still have questions? Join the support server →&nbsp;
              <a
                href="https://discord.gg/ynatEnRKWV"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#5865F2',
                  textDecoration: 'none',
                  fontFamily: 'monospace',
                }}
              >
                discord.gg/ynatEnRKWV
              </a>
            </div>
          </div>
        )}

        {/* TRY IT */}
        {activeTab === 'tryit' && <TryItTab darkMode={darkMode} theme={theme} />}

        {/* ADMIN */}
        {activeTab === 'admin' && <AdminPanel theme={theme} darkMode={darkMode} liveData={liveData} onRefresh={handleRefresh} refreshing={refreshing} lastSynced={lastSynced} />}

        {/* HOW IT WORKS */}
        {activeTab === 'architecture' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: '0 0 16px',
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  color: 'var(--muted)',
                  fontFamily: 'monospace',
                }}
              >
                Permission Levels
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PERMISSIONS.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '12px 16px',
                      background: `${p.color}0d`,
                      border: `1px solid ${p.color}33`,
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: p.color,
                        minWidth: 100,
                        fontSize: 13,
                      }}
                    >
                      {p.level}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--t)' }}>
                        {p.desc}
                      </div>
                      <div
                        style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
                      >
                        {p.cmds}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  color: 'var(--muted)',
                  fontFamily: 'monospace',
                }}
              >
                Backup Rules
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BACKUP_RULES.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '10px 14px',
                      background: 'var(--surface)',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>
                      {item.icon}
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--t)',
                          fontWeight: 500,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          marginTop: 2,
                          lineHeight: 1.5,
                        }}
                      >
                        {item.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  color: 'var(--muted)',
                  fontFamily: 'monospace',
                }}
              >
                What's Inside a Backup
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                {BACKUP_CONTENTS.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'rgba(88,101,242,0.05)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    <span
                      style={{ color: '#5865F2', fontSize: 8, flexShrink: 0 }}
                    >
                      ◆
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 20,
              }}
            >
              <h3
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  color: 'var(--muted)',
                  fontFamily: 'monospace',
                }}
              >
                Storage
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                }}
              >
                {STORAGE_ITEMS.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      background: 'var(--surface2)',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--t)' }}>
                        {item.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TERMS OF SERVICE */}
        {activeTab === 'tos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--faint)',
                fontFamily: 'monospace',
                marginBottom: 4,
              }}
            >
              Last updated: March 6, 2026
            </div>

            {[
              {
                title: '1. Acceptance',
                body: 'By adding Discord Backup Bot to your server or using any of its commands, you agree to these Terms of Service. If you do not agree, remove the bot from your server and stop using it.',
              },
              {
                title: '2. Eligibility',
                body: "You must comply with Discord's Terms of Service to use this bot. You must be the owner or an authorized administrator of any server you run commands on.",
              },
              {
                title: '3. What the Bot Does',
                body: "Discord Backup Bot stores snapshots of your server's structure (roles, channels, members, etc.) and allows you to restore them later. Backups are tied to the server they were created from and can only be loaded by the original server owner.",
              },
              {
                title: '4. Acceptable Use',
                body: "You agree not to use the bot to copy servers you do not own, circumvent Discord's rate limits maliciously, store or restore content that violates Discord's Terms of Service, or attempt to access or modify another user's backups.",
              },
              {
                title: '5. Backup Ownership',
                body: 'Backups are registered to the server they were created from. You may not load a backup that belongs to a server you do not own. Cross-server loading is blocked and any attempt to bypass this may result in being blocked from the service.',
              },
              {
                title: '6. Service Availability',
                body: 'We do not guarantee 100% uptime. The bot may be temporarily unavailable due to maintenance, Discord outages, or other circumstances. We are not liable for any data loss or disruption during downtime.',
              },
              {
                title: '7. Termination',
                body: "We reserve the right to block any server or user from the service at any time, for any reason, including but not limited to abuse, violations of these terms, or violations of Discord's Terms of Service. No refunds or appeals are guaranteed.",
              },
              {
                title: '8. Changes to Terms',
                body: 'These terms may be updated at any time. Continued use of the bot after changes are posted constitutes acceptance of the updated terms. Major changes will be announced in the support server.',
              },
              {
                title: '9. Contact',
                body: 'For questions, concerns, or to report abuse, join the support server at discord.gg/ynatEnRKWV and open a ticket.',
              },
            ].map((section, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: 'var(--t)',
                    marginBottom: 8,
                  }}
                >
                  {section.title}
                </div>
                <div
                  style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}
                >
                  {section.body}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PRIVACY POLICY */}
        {activeTab === 'privacy' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--faint)',
                fontFamily: 'monospace',
                marginBottom: 4,
              }}
            >
              Last updated: March 6, 2026
            </div>

            {[
              {
                title: '1. What We Collect',
                body: 'When you use Discord Backup Bot, we collect and store the following data as part of normal operation: Discord server IDs, Discord user IDs (server owners and admins), server structure data (roles, channels, categories, members, emojis, stickers, webhooks, and related settings), and optionally message history if you request a message backup.',
              },
              {
                title: '2. Why We Collect It',
                body: 'All data collected is strictly necessary for the bot to function. Server structure data is stored to create and restore backups. User IDs are stored to track backup ownership and enforce access control. We do not collect data for advertising, analytics, or any purpose beyond the core backup service.',
              },
              {
                title: '3. How Data Is Stored',
                body: 'Backup data is compressed and stored securely on our servers. Backups are automatically deleted after 30 days, or sooner if you manually delete them using the #$delbackup command. We do not share this data with any third parties.',
              },
              {
                title: '4. Who Can Access Your Data',
                body: 'Only the bot owner (potatofemboy) has access to raw backup data for maintenance purposes. Your backup data is never shared with other users. Other users cannot view, load, or delete your backups.',
              },
              {
                title: '5. Data Retention',
                body: 'Backup data is kept until you delete it. If you remove the bot from your server or are blocked from the service, your existing backups may be retained for a reasonable period before deletion. You can request manual deletion by contacting us in the support server.',
              },
              {
                title: '6. Message Data',
                body: 'Message backups are only created if you explicitly request them. We do not passively collect or read message content. Any message data stored as part of a requested backup is subject to the same storage and access rules as all other backup data.',
              },
              {
                title: '7. Your Rights',
                body: 'You can delete your own backups at any time using #$delbackup. You can request full deletion of your data by opening a ticket in the support server at discord.gg/ynatEnRKWV. We will process deletion requests within a reasonable timeframe.',
              },
              {
                title: '8. Changes to This Policy',
                body: 'This privacy policy may be updated at any time. Continued use of the bot after changes are posted means you accept the updated policy. Major changes will be announced in the support server.',
              },
              {
                title: '9. Contact',
                body: 'For any privacy-related questions or data deletion requests, join the support server at discord.gg/ynatEnRKWV and open a ticket.',
              },
            ].map((section, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: 'var(--t)',
                    marginBottom: 8,
                  }}
                >
                  {section.title}
                </div>
                <div
                  style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}
                >
                  {section.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          marginTop: 60,
          padding: '28px 20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <a
            href={BOT_INVITE_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#5865F2',
              textDecoration: 'none',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            + Add Bot
          </a>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              color: 'var(--muted)',
              textDecoration: 'none',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            Support Server
          </a>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--faint)',
            fontFamily: 'monospace',
          }}
        >
          made by potatofemboy1
        </div>
      </div>

      {/* Scroll to top */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#5865F2',
            border: 'none',
            color: '#fff',
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(88,101,242,0.4)',
            zIndex: 999,
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.opacity = '0.8')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.opacity = '1')
          }
          title="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}