/**
 * SSRF protection — resolves hostname to IP and checks if it's private/internal.
 * Root cause fix: validates the RESOLVED IP, not just the hostname string.
 * This prevents bypasses via IPv6-mapped IPv4 (::ffff:127.0.0.1),
 * DNS rebinding, and hostname tricks (localhost.attacker.com).
 */
import dns from 'dns/promises';
import net from 'net';

const BLOCKED_SUFFIXES = ['.svc.cluster.local', '.internal', '.localhost'];

function isPrivateIp(ip: string): boolean {
  // Normalize IPv6-mapped IPv4 (::ffff:127.0.0.1 → 127.0.0.1)
  const normalized = ip.replace(/^::ffff:/, '');

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    return false;
  }

  if (net.isIPv6(normalized)) {
    const full = normalized.toLowerCase();
    // ::1 (loopback)
    if (full === '::1' || full === '0:0:0:0:0:0:0:1') return true;
    // :: (unspecified)
    if (full === '::' || full === '0:0:0:0:0:0:0:0') return true;
    // fe80::/10 (link-local)
    if (full.startsWith('fe80:')) return true;
    // fc00::/7 (unique local)
    if (full.startsWith('fc') || full.startsWith('fd')) return true;
    return false;
  }

  return false;
}

export async function isPrivateUrl(parsed: URL): Promise<boolean> {
  const hostname = parsed.hostname.toLowerCase();

  // Block known internal suffixes
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) return true;
  }

  // If hostname is already an IP, check directly
  if (net.isIP(hostname)) {
    return isPrivateIp(hostname);
  }

  // Resolve DNS and check ALL resolved IPs
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      // Can't resolve → block to be safe
      const err = new Error('SSRF_BLOCKED');
      throw err;
    }

    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) return true;
    }
  } catch (err: any) {
    if (err?.message === 'SSRF_BLOCKED') throw err;
    // DNS resolution failed → block
    const ssrfErr = new Error('SSRF_BLOCKED');
    throw ssrfErr;
  }

  return false;
}
