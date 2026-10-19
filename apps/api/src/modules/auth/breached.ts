import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppError } from "../../common/http";
import { env } from "../../config/env";

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2_500;

/**
 * Refuses passwords that appear in known breaches (security review S20), using Have I Been Pwned's k-anonymity
 * range API: only the first 5 hex characters of the password's SHA-1 leave the server, and the reply is padded so
 * its size says nothing either. Fails open — if the service is slow or down, the password is accepted (the local
 * common-password rules in @triply/shared still apply). Off in tests (PASSWORD_BREACH_CHECK).
 */
@Injectable()
export class BreachedPasswords {
  private readonly log = new Logger("BreachedPasswords");
  /** Swappable in tests; production uses the global fetch. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  /** How many times the password was seen in breaches; null when the check is off or the service didn't answer. */
  async timesSeen(password: string): Promise<number | null> {
    if (env.PASSWORD_BREACH_CHECK !== "on") return null;
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await this.fetcher(RANGE_API + prefix, { headers: { "Add-Padding": "true", "User-Agent": "Golaly" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const line of (await res.text()).split("\n")) {
        const [hash, count] = line.trim().split(":");
        if (hash === suffix) return Number(count) || 0; // padding rows have a count of 0
      }
      return 0;
    } catch (e) {
      this.log.warn(`breach check skipped: ${(e as Error).message}`);
      return null;
    }
  }

  async assertNotBreached(password: string, field = "password") {
    if (((await this.timesSeen(password)) ?? 0) > 0) {
      const msg = "This password has appeared in a data breach, so attackers try it first. Choose a different one.";
      throw new AppError(422, msg, { [field]: msg });
    }
  }
}
