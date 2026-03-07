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
        perm: 'Owner',
      },
      {
        name: 'load',
        args: '<src_id> <tgt_id>',
        desc: 'Restore a backup onto a target server. If the source has multiple backups the bot lists them and waits for you to pick one.',
        perm: 'Owner',
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
  { label: 'Lines Of Code', value: 10000, suffix: '+' },
  { label: 'Commands', value: 15, suffix: '+' },
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
  {
    q: 'Who can back up a server?',
    a: 'Server owners with 20 or more members can run #$save on their own server. Managers can also trigger saves. If your server is whitelisted by the bot owner, the member count requirement is waived.',
  },
  {
    q: 'My server has under 20 members, can I still get a backup?',
    a: 'Not automatically. The bot will send you an invite to our support server when it leaves, and you can request a manual backup there: discord.gg/ynatEnRKWV',
  },
  {
    q: "Can I load someone else's backup?",
    a: "No. You can only load backups that are registered to your own server. The bot tracks backup ownership and will reject any attempt to load a backup you didn't create.",
  },
  {
    q: 'Can I restore onto a server with fewer than 20 members?',
    a: "Yes, the 20-member limit only applies when creating a new backup. Loading an existing backup has no member count requirement, as long as it's your own server.",
  },
  {
    q: 'What does a backup include?',
    a: 'Roles, channels, categories, emojis, stickers, bans, members, webhooks, automod rules, scheduled events, welcome screen, soundboard, threads, and optionally message history.',
  },
  {
    q: 'How are backups stored?',
    a: 'Backups are compressed and stored securely on our servers. Multiple backups per server are kept, but are automatically deleted after 30 days. Use #$delbackup to clean up old ones manually.',
  },
  {
    q: "What's the difference between Manager and Admin?",
    a: 'Manager is above Admin. Managers have all Admin permissions plus the ability to trigger server backups. Admins handle access control and server info commands.',
  },
  {
    q: 'I got blocked, what do I do?',
    a: 'If your server or account has been blocked from using the backup system, join the support server at discord.gg/ynatEnRKWV and open a ticket.',
  },
  {
    q: 'Does restoring a backup wipe my current server?',
    a: 'Yes. The restore process deletes existing channels and roles before rebuilding from the backup. Make sure you want to fully overwrite the target server before running #$load.',
  },
  {
    q: 'Does the bot save message history by default?',
    a: 'No. Message history is opt-in. During the #$save flow the bot will ask whether you want to capture messages and which channels to include.',
  },
  {
    q: 'How many backups can I store per server?',
    a: 'There is no hard limit on the number of backups, but all backups are automatically deleted after 30 days. Use #$backups to see what you have and #$delbackup to clean up manually before then.',
  },
  {
    q: 'Can I cancel or change my autobackup schedule?',
    a: 'Yes. Use #$autobackup cancel <server_id> to remove a schedule, or run #$autobackup <server_id> <hours> again to reconfigure it. The setup walks you through the same steps as #$save (blacklist, members, format, encryption, message capture). All schedules are clock-aligned to UTC midnight — a 1h and 3h schedule will both fire together at 3am, 6am, 9am, etc. Schedules survive bot restarts.',
  },
  {
    q: 'What are the helper bots?',
    a: 'The bot runs 5 parallel helper bot instances alongside the main bot. During a restore, roles and channels are created across all instances simultaneously to work around Discord\'s rate limits and speed up large restores.',
  },
  {
    q: 'What happens if the bot goes offline mid-backup or mid-restore?',
    a: 'The bot has a heartbeat and downtime detector. If it crashes mid-operation the backup or restore may be incomplete, so you can re-run the command once the bot is back online. Use #$verifybackup to confirm a saved backup is intact before restoring.',
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

type AdminView = 'dashboard' | 'backups' | 'servers' | 'access' | 'logs';

function AdminPanel({ theme, darkMode, liveData, onRefresh, refreshing, lastSynced }: { theme: Record<string,string>; darkMode: boolean; liveData: any; onRefresh: () => Promise<void>; refreshing: boolean; lastSynced: number | null }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);
  const [pwChecking, setPwChecking] = useState(false);
  const [view, setView] = useState<AdminView>('dashboard');
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [serverSort, setServerSort] = useState<'members_desc' | 'members_asc' | 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'backed_up'>('members_desc');

  const ADMIN_VIEWS: { id: AdminView; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard',    icon: '📊' },
    { id: 'servers',   label: 'Servers',      icon: '🌐' },
    { id: 'backups',   label: 'Backups',      icon: '💾' },
    { id: 'access',    label: 'Access Control', icon: '🔐' },
    { id: 'logs',      label: 'Logs',         icon: '📋' },
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
            transition: 'background 0.15s',
          }}>
            {v.icon} {v.label}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
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

            {allGuilds.length === 0 && <div style={{ color: theme.muted, fontSize: 13 }}>No live guild data yet. Hit Refresh or check back after bot restart.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...allGuilds].sort((a, b) => {
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {backupServerIds.map(sid => {
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
                            >{copiedId === `#$delbackup ${sid} ${entries.length - i}` ? '✓ copied' : '🗑 delete'}</button>
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      // GitHub API returns content as base64-encoded string
      const decoded = atob(envelope.content.replace(/\n/g, ''));
      const json = JSON.parse(decoded);
      setLiveData(json);
      setLastSynced(Date.now());
    } catch {
      /* fall back to static */
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
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch(DATA_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setLiveData(json);
          setLastSynced(Date.now());
        }
      } catch {
        /* fall back to static */
      }
    }
    fetchOnce();
    const iv = setInterval(fetchOnce, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

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
            {FAQ.filter(item =>
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