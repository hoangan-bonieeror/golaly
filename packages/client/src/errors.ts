/** An API failure with a message that is safe to show (the API's own friendly text, or a generic one). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Shown when the API answers an error without a usable message. */
export const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Please log in to continue.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  409: "That conflicts with something that already exists.",
  422: "Some fields need attention.",
  429: "You're doing that a bit too fast. Please wait a moment.",
};

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const OFFLINE_ERROR = "Can't reach Golaly right now. Check your connection and try again.";
