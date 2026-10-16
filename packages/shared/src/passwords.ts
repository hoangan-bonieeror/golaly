/**
 * Password strength rules shared by the web form and the API (security review S20, NIST SP 800-63B §5.1.1.2):
 * at least 8 characters, and not one that attackers try first — common passwords, one repeated character, a
 * keyboard or alphabet run. The API additionally checks breached-password lists (Have I Been Pwned, k-anonymity).
 */

// Commonly leaked passwords of 8+ characters (lower-case; compared case-insensitively), incl. Vietnamese favourites.
const COMMON = new Set(
  `password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword pa$$word passwort motdepasse
  12345678 123456789 1234567890 0123456789 87654321 987654321 9876543210 12341234 12344321 11223344 12121212 147258369
  123123123 123321123 147852369 159357456 1234567a 12345678a 123456789a a12345678 a123456789 1234567890a 123456aa
  qwertyui qwertyuiop qwerty12 qwerty123 qwerty1234 1qaz2wsx 1qaz2wsx3edc zaq12wsx zaq1zaq1 1q2w3e4r 1q2w3e4r5t
  1q2w3e4r5t6y q1w2e3r4 q1w2e3r4t5 qweasdzxc 123qweasd 1234qwer qwer1234 asdfghjk asdfghjkl asdf1234 asdfasdf zxcvbnm1
  zxcvbnm123 abc12345 abcd1234 abcdefg1 a1b2c3d4 1a2b3c4d aa123456 iloveyou iloveyou1 iloveyou2 iloveu123 sunshine
  princess football baseball basketball superman batman123 starwars trustno1 welcome1 welcome123 letmein1 letmein123
  monkey123 dragon123 master123 shadow123 michael1 jennifer michelle jordan23 computer internet whatever chocolate
  butterfly liverpool chelsea1 arsenal1 pokemon1 naruto123 doraemon samsung1 iphone123 football1 changeme changeme1
  admin123 admin1234 administrator root1234 test1234 testtest guest123 default1 secret123 supersecret qwerty11
  matkhau matkhau1 matkhau123 anhyeuem anhyeuem1 emyeuanh yeuemnhieu iloveyouvn vietnam1 vietnam123 hanoi123
  saigon123 conchimnon 123456vn triply123 travel123 traveling vacation holiday1 demo1234`.split(/\s+/),
);

const ROWS = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** True for a password that's in the common list, one repeated character, or a straight run (abcdefgh, 98765432). */
export function isWeakPassword(password: string): boolean {
  const p = password.trim().toLowerCase();
  if (COMMON.has(p)) return true;
  if (new Set(p).size <= 2) return true; // aaaaaaaa, abababab
  return ROWS.some((row) => row.includes(p) || [...row].reverse().join("").includes(p));
}

/** True when the password contains the username or the e-mail's name part (4+ characters). */
export function passwordContainsIdentity(password: string, identity: { username?: string; email?: string }): boolean {
  const p = password.toLowerCase();
  const parts = [identity.username, identity.email?.split("@")[0]].map((s) => s?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "");
  return parts.some((s) => s.length >= 4 && p.replace(/[^a-z0-9]/g, "").includes(s));
}
