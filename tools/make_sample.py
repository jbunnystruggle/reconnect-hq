"""Generates fictional sample data in LinkedIn's export format (sample/Connections.csv, sample/messages.csv).

Every person, company and message here is made up. Run: python3 tools/make_sample.py
"""
import csv
import io
import random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(7)
ROOT = Path(__file__).resolve().parent.parent
ME_NAME, ME_URL = "Sam Sample", "https://www.linkedin.com/in/sam-sample-demo"
TODAY = date(2026, 11, 1)

FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Quinn", "Rowan", "Harper", "Emerson", "Finley", "Sage", "Reese",
         "Parker", "Hayden", "Skyler", "Dakota", "Ellis", "Marlowe", "Remy", "Blake", "Kendall", "Shiloh", "Arden", "Lennox",
         "Tatum", "Jules", "Noor", "Priya", "Mateo", "Ines", "Kenji", "Amara", "Theo", "Lucia", "Omar", "Freya"]
LAST = ["Example", "Placeholder", "Sampleton", "Demowalker", "Fictive", "Mockford", "Testerly", "Pretendson", "Imaginary",
        "Madeup", "Notreal", "Dummyworth", "Lorem", "Ipsumsen", "Prototype", "Sketchley"]
COMPANIES = ["Northwind Learning", "Contoso Health", "Fabrikam Labs", "Tailspin Analytics", "Woodgrove Studio", "Litware Ed",
             "Adventure Works", "Proseware", "Wide World Media", "Blue Yonder Robotics", "Fourth Coffee", "Lamna Learning",
             "Trey Research", "Alpine Ski House", "Margie's Travel", "Coho Vineyard"]
TITLES = ["Senior Product Manager", "Product Manager", "Director of Product", "VP of Product", "Group PM", "Head of Product",
          "Staff Software Engineer", "Engineering Manager", "UX Researcher", "Senior Product Designer", "Data Scientist",
          "Customer Success Lead", "Marketing Director", "Founder & CEO", "Learning Experience Designer", "Recruiter",
          "Chief Product Officer", "Technical Program Manager", "Content Strategist", "Partnerships Lead"]
LINES_THEM = ["Great to meet you at the conference!", "Thanks for the intro — happy to chat next week.",
              "Would love to hear what you're building.", "Congrats on the new role!", "Sending that article I mentioned.",
              "Let's grab coffee when you're in town.", "Thanks for the feedback on our beta."]
LINES_ME = ["Thanks so much — talk soon!", "Absolutely, sending a calendar invite.", "Appreciate it! Here's the deck.",
            "Loved your talk on research ops.", "Happy to make that intro.", "Following up on our chat last month."]


def slug(s):
    return "".join(ch if ch.isalnum() else "-" for ch in s.lower()).strip("-")


def fmt_conn_date(d):
    return d.strftime("%d %b %Y")


def main():
    people = []
    used = set()
    while len(people) < 60:
        first, last = random.choice(FIRST), random.choice(LAST)
        if (first, last) in used:
            continue
        used.add((first, last))
        connected = TODAY - timedelta(days=random.randint(20, 2600))
        people.append({
            "first": first, "last": last,
            "url": f"https://www.linkedin.com/in/{slug(first)}-{slug(last)}-demo",
            "company": random.choice(COMPANIES), "position": random.choice(TITLES), "connected": connected,
        })

    out = io.StringIO()
    out.write('Notes:\n"This is fictional sample data for Reconnect HQ. It follows the format of LinkedIn\'s Connections.csv."\n\n')
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"])
    for p in sorted(people, key=lambda p: p["connected"], reverse=True):
        w.writerow([p["first"], p["last"], p["url"], "", p["company"], p["position"], fmt_conn_date(p["connected"])])
    (ROOT / "sample" / "Connections.csv").write_text(out.getvalue(), encoding="utf-8")

    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writerow(["CONVERSATION ID", "CONVERSATION TITLE", "FROM", "SENDER PROFILE URL", "TO", "RECIPIENT PROFILE URLS",
                "DATE", "SUBJECT", "CONTENT", "FOLDER", "ATTACHMENTS"])
    for i, p in enumerate(random.sample(people, 26)):
        name = f'{p["first"]} {p["last"]}'
        conv = f"demo-conversation-{i:03d}"
        start = datetime.combine(TODAY - timedelta(days=random.randint(5, 900)), datetime.min.time()) + timedelta(hours=10)
        for j in range(random.randint(1, 9)):
            t = start + timedelta(days=j * random.randint(1, 6), minutes=random.randint(0, 600))
            if t.date() > TODAY:
                break
            mine = (j % 2 == 1) if random.random() < 0.8 else True
            if mine:
                row = [ME_NAME, ME_URL, name, p["url"], random.choice(LINES_ME)]
            else:
                row = [name, p["url"], ME_NAME, ME_URL, random.choice(LINES_THEM)]
            w.writerow([conv, "", row[0], row[1], row[2], row[3], t.strftime("%Y-%m-%d %H:%M:%S UTC"), "", row[4], "INBOX", ""])
    (ROOT / "sample" / "messages.csv").write_text(out.getvalue(), encoding="utf-8")
    print("wrote sample/Connections.csv and sample/messages.csv")


if __name__ == "__main__":
    main()
