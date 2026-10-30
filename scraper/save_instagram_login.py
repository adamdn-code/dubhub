"""
Saves the DubHub Instagram login for uw_instagram_scraper.py from a browser's
"sessionid" cookie. Use this when "python -m instaloader --login=..." keeps
hitting "Checkpoint required".

1. In your browser, log into instagram.com as the DubHub account.
2. Press F12 > Application > Cookies > https://www.instagram.com and copy the
   value of the "sessionid" row. Treat it like a password; don't share it.
3. Run (from this folder):  python save_instagram_login.py
   and paste the value when asked (it won't show while you paste).
"""

import getpass
import sys
import urllib.parse

import instaloader
import requests

EXPECTED = "dubhub.uw"


def main():
    session_id = urllib.parse.unquote(getpass.getpass("Paste the sessionid cookie (hidden), then press Enter: ").strip())
    if not session_id:
        sys.exit("Nothing pasted.")

    # Instaloader also needs a csrftoken; Instagram hands out a fresh one on any page load.
    s = requests.Session()
    s.cookies.set("sessionid", session_id, domain=".instagram.com")
    s.get("https://www.instagram.com/", headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    csrf = s.cookies.get("csrftoken", domain=".instagram.com") or s.cookies.get("csrftoken")

    L = instaloader.Instaloader()
    L.load_session(EXPECTED, {"sessionid": session_id, "csrftoken": csrf, "ds_user_id": session_id.split(":")[0]})
    username = L.test_login()
    if not username:
        sys.exit("Instagram didn't accept that cookie. Copy it again while logged in, and try again.")
    if username.lower() != EXPECTED:
        sys.exit(f"That cookie is for @{username}, not @{EXPECTED}. Log in as @{EXPECTED} and copy it again. "
                 "Nothing was saved.")

    L.context.username = username
    L.save_session_to_file()
    print(f"Saved the login for @{username}. Now run: python uw_instagram_scraper.py")


if __name__ == "__main__":
    main()
