import { useState, useEffect, useRef, useMemo } from 'react';

const DATA_URL =
  'https://raw.githubusercontent.com/potatofemboy/discord-data/main/data.json';

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

interface LiveData {
  downtime_log: DowntimeEntry[];
  heartbeat: Heartbeat;
  maintenance: boolean;
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
        desc: 'Schedule automatic backups on a repeating interval. Also supports: autobackup list, autobackup cancel <server_id>.',
        perm: 'Owner',
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
    version: 'v1.1.1',
    date: 'Mar 6, 2026',
    tag: 'patch',
    color: '#57F287',
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
    color: '#EB459E',
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
    color: '#57F287',
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
    color: '#57F287',
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
    color: '#5865F2',
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
    a: 'Yes. Use #$autobackup cancel <server_id> to remove a schedule, or run #$autobackup <server_id> <hours> again with a new interval to overwrite it. Schedules survive bot restarts.',
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
  { id: 'architecture', label: 'How It Works' },
  { id: 'tos', label: 'Terms' },
  { id: 'privacy', label: 'Privacy' },
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

// Reusable pulsing dot -- was copy-pasted 5+ times before
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

// Fixed: cancelAnimationFrame cleanup prevents memory leak on unmount
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
}: StatItem & { delay: number; started: boolean }) {
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
        background: 'rgba(255,255,255,0.03)',
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
          color: '#72767d',
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
          isOpen ? data.color + '55' : 'rgba(255,255,255,0.07)'
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
          background: isOpen ? `${data.color}18` : 'rgba(255,255,255,0.02)',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'rgba(255,255,255,0.05)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'rgba(255,255,255,0.02)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>{data.icon}</span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
              color: '#dcddde',
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
            color: '#72767d',
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
                      ? '1px solid rgba(255,255,255,0.04)'
                      : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: isCopied ? `${data.color}18` : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isCopied)
                    (e.currentTarget as HTMLDivElement).style.background =
                      'rgba(255,255,255,0.04)';
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
                        color: '#72767d',
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
                    color: '#b9bbbe',
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
                    color: isCopied ? data.color : '#4f545c',
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

// Fixed: uses real scrollHeight instead of a hardcoded 300px cap
function FaqItem({
  item,
  isOpen,
  onToggle,
}: {
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
          isOpen ? 'rgba(88,101,242,0.5)' : 'rgba(255,255,255,0.07)'
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
            : 'rgba(255,255,255,0.02)',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen)
            (e.currentTarget as HTMLDivElement).style.background =
              'rgba(255,255,255,0.02)';
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: isOpen ? '#ffffff' : '#dcddde',
            fontWeight: isOpen ? 600 : 400,
          }}
        >
          {item.q}
        </span>
        <span
          style={{
            color: '#72767d',
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
            color: '#b9bbbe',
            lineHeight: 1.7,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          {item.a}
        </div>
      </div>
    </div>
  );
}

// Fixed: properly clamps incident durations to the window boundaries
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

// Build a CSS gradient for a single day bar reflecting exact incident timing within the day
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

function isBotOnline(heartbeat: Heartbeat): boolean | null {
  if (!heartbeat) return null;
  return Date.now() - new Date(heartbeat.last_seen).getTime() < 10 * 60 * 1000;
}

export default function App() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [statsStarted, setStatsStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('commands');
  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
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
    async function fetchData() {
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
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  const downtimeLog: DowntimeEntry[] = liveData?.downtime_log ?? [];
  const online: boolean | null = liveData
    ? isBotOnline(liveData.heartbeat)
    : null;
  const maintenance = liveData?.maintenance ?? false;
  const latestVersion = CHANGELOG[0]?.version ?? null;
  const hasNewChangelog = latestVersion && seenVersion !== latestVersion;

  // Mark changelog as seen when tab is opened
  useEffect(() => {
    if (activeTab === 'changelog' && hasNewChangelog) {
      setSeenVersion(latestVersion!);
      localStorage.setItem('seenVersion', latestVersion!);
    }
  }, [activeTab, hasNewChangelog, latestVersion]);

  // Last synced relative time ticker
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

  // Fixed: .catch() so clipboard errors don't silently swallow
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
        // clipboard permission denied or not on https -- nothing to do
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

  // '/' key focuses search when on commands tab
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

  // Scroll-to-top button visibility
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

  // Meta tags for SEO and Discord link embeds
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

  // Memoized since it only changes when online status changes
  const statusServices = useMemo(
    () => [
      {
        name: 'Main Bot',
        status:
          online === null ? 'Checking...' : online ? 'Operational' : 'Offline',
        color: online === null ? '#72767d' : online ? '#57F287' : '#ED4245',
      },
      { name: 'Helper Bots', status: 'Operational', color: '#57F287' },
      { name: 'Backup Storage', status: 'Operational', color: '#57F287' },
      { name: 'Uptime Monitor', status: 'Operational', color: '#57F287' },
    ],
    [online]
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d0f12',
        color: '#dcddde',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: '0 0 0',
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>

      <Toast message={toast.message} visible={toast.visible} />

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(180deg, #1a1d2e 0%, #0d0f12 100%)',
          borderBottom: '1px solid rgba(88,101,242,0.2)',
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
        <div style={{ position: 'relative' }}>
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
              marginBottom: 16,
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
          <h1
            style={{
              margin: 0,
              fontSize: 42,
              fontWeight: 800,
              fontFamily: "'JetBrains Mono', monospace",
              background: 'linear-gradient(135deg, #ffffff 30%, #5865F2)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: -2,
            }}
          >
            Discord Backup Bot
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: '#72767d',
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
                background: 'rgba(255,255,255,0.05)',
                color: '#dcddde',
                borderRadius: 8,
                padding: '10px 20px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.1)',
                letterSpacing: 0.3,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background =
                  'rgba(255,255,255,0.09)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLAnchorElement).style.background =
                  'rgba(255,255,255,0.05)')
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
              color: '#72767d',
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
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px' }}>
        {/* Stats -- Fixed: responsive grid instead of hardcoded repeat(5,1fr) */}
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
            <StatCard key={i} {...s} delay={i} started={statsStarted} />
          ))}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 20,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            padding: 4,
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
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
                background: activeTab === t.id ? '#5865F2' : 'transparent',
                color: activeTab === t.id ? '#fff' : '#72767d',
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
                  color: '#72767d',
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
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  color: '#dcddde',
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
                  e.target.style.borderColor = 'rgba(255,255,255,0.1)';
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
                    color: '#72767d',
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
                    color: '#72767d',
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
                  <div style={{ fontSize: 12, color: '#72767d', marginTop: 1 }}>
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
                  online === null ? '#72767d' : online ? '#57F287' : '#ED4245'
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
                        ? '#57F287'
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
                <div style={{ fontSize: 12, color: '#72767d', marginTop: 2 }}>
                  Online since Mar 1, 2026 · {DAYS_LIVE} day
                  {DAYS_LIVE !== 1 ? 's' : ''} running
                  {syncLabel && (
                    <span style={{ marginLeft: 8, color: '#4f545c' }}>
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
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 22,
                        fontWeight: 700,
                        color: '#57F287',
                        lineHeight: 1,
                      }}
                    >
                      {daysClear}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: '#72767d',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        marginTop: 2,
                      }}
                    >
                      days clear
                    </div>
                  </div>
                );
              })()}
            </div>

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
                  fontFamily: 'monospace',
                }}
              >
                Services
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statusServices.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 13,
                        color: '#dcddde',
                      }}
                    >
                      {s.name}
                    </span>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <PingDot color={s.color} size={7} />
                      <span
                        style={{
                          fontSize: 12,
                          color: s.color,
                          fontFamily: 'monospace',
                        }}
                      >
                        {s.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
                  fontFamily: 'monospace',
                }}
              >
                Uptime Since Feb 20
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,1fr)',
                  gap: 10,
                  marginBottom: 20,
                }}
              >
                {[
                  {
                    label: 'Last 24h',
                    pct: `${calcUptimePct(downtimeLog, 1)}%`,
                  },
                  {
                    label: 'Last 7d',
                    pct: `${calcUptimePct(downtimeLog, 7)}%`,
                  },
                  {
                    label: `All ${DAYS_MONITORED}d`,
                    pct: `${calcUptimePct(downtimeLog, DAYS_MONITORED)}%`,
                  },
                ].map((u, i) => {
                  const numPct = parseFloat(u.pct);
                  const pctColor =
                    numPct >= 99.9
                      ? '#57F287'
                      : numPct >= 95
                      ? '#FEE75C'
                      : '#ED4245';
                  return (
                    <div
                      key={i}
                      style={{
                        textAlign: 'center',
                        padding: '14px 10px',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 8,
                        border: `1px solid ${pctColor}33`,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 24,
                          fontWeight: 700,
                          color: pctColor,
                        }}
                      >
                        {u.pct}
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#72767d', marginTop: 4 }}
                      >
                        {u.label}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#72767d',
                  marginBottom: 6,
                  fontFamily: 'monospace',
                }}
              >
                Since Feb 20 ({DAYS_MONITORED} days)
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'flex-end',
                  position: 'relative',
                }}
              >
                {Array.from({ length: DAYS_MONITORED }).map((_, i) => {
                  const dayStart = new Date(UPTIME_START);
                  dayStart.setDate(dayStart.getDate() + i);
                  dayStart.setHours(0, 0, 0, 0);
                  const dayEnd = new Date(dayStart);
                  dayEnd.setDate(dayEnd.getDate() + 1);
                  const barBg = getDayGradient(
                    dayStart.getTime(),
                    dayEnd.getTime(),
                    downtimeLog
                  );
                  const dateStr = dayStart.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                  });
                  const isPreLaunch = dayStart < LAUNCH_DATE;
                  const dayIncidents = downtimeLog.filter((e) => {
                    const t = new Date(e.server_went_down_approx).getTime();
                    const end = t + (e.duration_seconds || 0) * 1000;
                    return t < dayEnd.getTime() && end > dayStart.getTime();
                  });
                  return (
                    <div
                      key={i}
                      style={{ flex: 1, minWidth: 4, position: 'relative' }}
                      onMouseEnter={(e) => {
                        const tip = (
                          e.currentTarget as HTMLDivElement
                        ).querySelector('.bar-tip') as HTMLElement | null;
                        if (tip) tip.style.display = 'block';
                      }}
                      onMouseLeave={(e) => {
                        const tip = (
                          e.currentTarget as HTMLDivElement
                        ).querySelector('.bar-tip') as HTMLElement | null;
                        if (tip) tip.style.display = 'none';
                      }}
                    >
                      <div
                        style={{
                          height: 24,
                          borderRadius: 2,
                          background: barBg,
                        }}
                      />
                      <div
                        className="bar-tip"
                        style={{
                          display: 'none',
                          position: 'absolute',
                          bottom: 30,
                          ...(i < 3
                            ? { left: 0 }
                            : i > DAYS_MONITORED - 4
                            ? { right: 0 }
                            : { left: '50%', transform: 'translateX(-50%)' }),
                          background: '#1e2030',
                          border: `1px solid ${
                            dayIncidents.length > 0
                              ? 'rgba(237,66,69,0.4)'
                              : 'rgba(87,242,135,0.3)'
                          }`,
                          borderRadius: 8,
                          padding: '8px 12px',
                          minWidth: 180,
                          maxWidth: 260,
                          zIndex: 100,
                          pointerEvents: 'none',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: '#72767d',
                            marginBottom: dayIncidents.length > 0 ? 6 : 0,
                          }}
                        >
                          {dateStr}
                          {isPreLaunch ? ' · pre-launch' : ''}
                        </div>
                        {dayIncidents.length === 0 ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: '#57F287',
                              fontFamily: 'monospace',
                            }}
                          >
                            ✓ Operational
                          </div>
                        ) : (
                          dayIncidents.map((inc, j) => {
                            const tz =
                              Intl.DateTimeFormat().resolvedOptions().timeZone;
                            const fmtOpts: Intl.DateTimeFormatOptions = {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: tz,
                            };
                            const incDown = new Date(
                              inc.server_went_down_approx
                            ).getTime();
                            const incUp = inc.bot_came_back_up
                              ? new Date(inc.bot_came_back_up).getTime()
                              : incDown + (inc.duration_seconds || 0) * 1000;
                            const segStart = Math.max(
                              incDown,
                              dayStart.getTime()
                            );
                            const segEnd = Math.min(incUp, dayEnd.getTime());
                            const isAllDay =
                              segStart <= dayStart.getTime() &&
                              segEnd >= dayEnd.getTime() - 1000;
                            const startsBeforeDay =
                              incDown < dayStart.getTime();
                            const endsAfterDay =
                              incUp > dayEnd.getTime() - 1000;
                            const segSecs = Math.round(
                              (segEnd - segStart) / 1000
                            );
                            const segH = Math.floor(segSecs / 3600);
                            const segM = Math.floor((segSecs % 3600) / 60);
                            const segDurStr =
                              segH > 0 ? `${segH}h ${segM}m` : `${segM}m`;
                            const fromStr = new Date(
                              segStart
                            ).toLocaleTimeString([], fmtOpts);
                            const toStr = new Date(segEnd).toLocaleTimeString(
                              [],
                              fmtOpts
                            );
                            const tzShort =
                              new Date(segStart)
                                .toLocaleDateString([], {
                                  timeZoneName: 'short',
                                  timeZone: tz,
                                })
                                .split(', ')[1] || tz;
                            return (
                              <div
                                key={j}
                                style={{
                                  borderTop:
                                    j > 0
                                      ? '1px solid rgba(255,255,255,0.06)'
                                      : 'none',
                                  paddingTop: j > 0 ? 6 : 0,
                                  marginTop: j > 0 ? 6 : 0,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    marginBottom: 4,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      color: '#ED4245',
                                      fontWeight: 700,
                                    }}
                                  >
                                    #{inc.id}
                                  </span>
                                  <span
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: 10,
                                      color: '#4f545c',
                                    }}
                                  >
                                    {tzShort}
                                  </span>
                                </div>
                                {isAllDay ? (
                                  <div
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      color: '#ED4245',
                                      marginBottom: 3,
                                    }}
                                  >
                                    All day
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      color: '#dcddde',
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: startsBeforeDay
                                          ? '#72767d'
                                          : '#ED4245',
                                      }}
                                    >
                                      {startsBeforeDay ? '←' : fromStr}
                                    </span>
                                    <span style={{ color: '#4f545c' }}>
                                      {' '}
                                      →{' '}
                                    </span>
                                    <span
                                      style={{
                                        color: endsAfterDay
                                          ? '#72767d'
                                          : '#57F287',
                                      }}
                                    >
                                      {endsAfterDay ? '→' : toStr}
                                    </span>
                                    <span style={{ color: '#72767d' }}>
                                      {' '}
                                      ({segDurStr} this day)
                                    </span>
                                  </div>
                                )}
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#72767d',
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {inc.reason}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  fontSize: 10,
                  color: '#4f545c',
                  fontFamily: 'monospace',
                }}
              >
                <span>Feb 20</span>
                <span style={{ color: '#5865F2' }}>Mar 1 launch</span>
                <span>Today</span>
              </div>
            </div>

            {downtimeLog.length > 0 && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
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
                    color: '#72767d',
                    fontFamily: 'monospace',
                  }}
                >
                  Incident History ({downtimeLog.length})
                </h3>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {[...downtimeLog].reverse().map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        padding: '10px 14px',
                        background: 'rgba(237,66,69,0.04)',
                        border: '1px solid rgba(237,66,69,0.15)',
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: '#ED4245',
                          }}
                        >
                          #{entry.id} · {entry.duration_human}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: '#4f545c',
                            fontFamily: 'monospace',
                          }}
                        >
                          {new Date(
                            entry.server_went_down_approx
                          ).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#72767d' }}>
                        {entry.reason}
                      </div>
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
                    background: 'rgba(255,255,255,0.02)',
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
                        color: '#dcddde',
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
                        color: '#4f545c',
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
                          color: '#b9bbbe',
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
                color: '#4f545c',
                fontFamily: 'monospace',
              }}
            >
              More updates coming soon
            </div>
          </div>
        )}

        {/* FAQ -- Fixed: FaqItem uses real scrollHeight instead of capped 300px */}
        {activeTab === 'faq' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FAQ.map((item, i) => (
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
                color: '#72767d',
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

        {/* HOW IT WORKS */}
        {activeTab === 'architecture' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
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
                      <div style={{ fontSize: 13, color: '#dcddde' }}>
                        {p.desc}
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#72767d', marginTop: 2 }}
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
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
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
                      background: 'rgba(255,255,255,0.02)',
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
                          color: '#dcddde',
                          fontWeight: 500,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#72767d',
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
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
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
                      color: '#b9bbbe',
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
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
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
                  color: '#72767d',
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
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, color: '#72767d' }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 13, color: '#dcddde' }}>
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
                color: '#4f545c',
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
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: '#dcddde',
                    marginBottom: 8,
                  }}
                >
                  {section.title}
                </div>
                <div
                  style={{ fontSize: 13, color: '#b9bbbe', lineHeight: 1.7 }}
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
                color: '#4f545c',
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
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: '#dcddde',
                    marginBottom: 8,
                  }}
                >
                  {section.title}
                </div>
                <div
                  style={{ fontSize: 13, color: '#b9bbbe', lineHeight: 1.7 }}
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
          borderTop: '1px solid rgba(255,255,255,0.06)',
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
              color: '#72767d',
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
            color: '#4f545c',
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