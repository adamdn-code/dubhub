// DubHub's open roles, shown in the Careers section of the About page. api/apply.js checks
// applications against this same list, so a role's id and question ids must stay the same once
// people have applied to it.
//
// These are sample roles for now: while SAMPLE_JOBS is true the page says so above the list.
export const SAMPLE_JOBS = true;

// Asked on every application, after the role's own questions.
const LAST_QUESTION = { id: "anything-else", label: "Anything else you'd like us to know?", max: 1000 };

export const JOBS = [
  {
    id: "frontend-engineer",
    title: "Founding Frontend Engineer",
    team: "Engineering",
    location: "Seattle (hybrid)",
    type: "Part-time",
    summary: "Build the map, filters, and event pages Huskies use to find something to do.",
    about:
      "You'll own big pieces of what students see first: the live map, event cards, and sign-up flows. We ship small changes every week and talk to students about every one of them.",
    youWill: [
      "Build features in React from idea to launch",
      "Make the map fast and easy to use on phones",
      "Talk to students and turn what they say into improvements",
    ],
    fit: ["You've built a website or app people actually used", "You know JavaScript and React (or want to, fast)", "You care about small details"],
    questions: [
      { id: "built", label: "Tell us about something you built that you're proud of. Link it if you can.", required: true, max: 1500 },
      { id: "first-change", label: "What's one thing you'd change about DubHub first, and why?", required: true, max: 1000 },
      LAST_QUESTION,
    ],
  },
  {
    id: "data-engineer",
    title: "Data Engineer, Events",
    team: "Engineering",
    location: "Seattle or remote",
    type: "Part-time",
    summary: "Keep every club's events on the map, from HuskyLink, Instagram, and beyond.",
    about:
      "DubHub is only as good as its events. You'll run and improve the scrapers that find them, clean up what they bring back, and make sure the same event never shows up twice.",
    youWill: [
      "Improve the scrapers for HuskyLink and club Instagram accounts",
      "Find new places where clubs post their events",
      "Catch duplicates, wrong times, and wrong places before students see them",
    ],
    fit: ["You're comfortable with Python", "You like turning messy data into something useful", "You've used an API or scraped a website before"],
    questions: [
      { id: "messy-data", label: "Describe a time you turned messy data into something useful.", required: true, max: 1500 },
      { id: "new-source", label: "Where else do UW clubs post events that DubHub should read, and how would you get them?", required: true, max: 1000 },
      LAST_QUESTION,
    ],
  },
  {
    id: "product-designer",
    title: "Product Designer",
    team: "Design",
    location: "Seattle (hybrid)",
    type: "Part-time",
    summary: "Design how students discover events, join them, and bring their friends.",
    about:
      "You'll design new features from first sketch to final screen, and work right alongside the engineers building them. Good taste matters more than years of experience.",
    youWill: [
      "Design new features and improve the ones we have",
      "Test ideas with students before we build them",
      "Keep DubHub looking and feeling like one product",
    ],
    fit: ["You have a portfolio, even a small one", "You know Figma or a similar tool", "You notice when an app feels off, and can say why"],
    questions: [
      { id: "portfolio", label: "Link your portfolio or a project you designed, and tell us your part in it.", required: true, max: 1000 },
      { id: "redesign", label: "Pick one screen on DubHub. What would you redesign, and why?", required: true, max: 1500 },
      LAST_QUESTION,
    ],
  },
  {
    id: "campus-ambassador",
    title: "Campus Ambassador",
    team: "Growth",
    location: "UW Seattle",
    type: "Flexible hours",
    summary: "Bring DubHub to your clubs, classes, and friends, and tell us what they think.",
    about:
      "Ambassadors are how DubHub grows. You'll help clubs post their events, get students trying the map, and bring back honest feedback from your corner of campus.",
    youWill: [
      "Help clubs you know get their events on DubHub",
      "Run sign-ups at events, tabling, and in Red Square",
      "Tell us what students like, and what they don't",
    ],
    fit: ["You're involved in at least one club or community at UW", "You like meeting new people", "You're organized and follow through"],
    questions: [
      { id: "communities", label: "Which clubs or communities at UW are you part of?", required: true, max: 1000 },
      { id: "hundred-students", label: "How would you get 100 students to try DubHub this month?", required: true, max: 1500 },
      LAST_QUESTION,
    ],
  },
  {
    id: "marketing-lead",
    title: "Social Media & Marketing Lead",
    team: "Growth",
    location: "UW Seattle",
    type: "Part-time",
    summary: "Make DubHub the first place students check before the weekend.",
    about:
      "You'll run DubHub's Instagram and TikTok, plan launches with clubs, and find out what makes students share. Everything you post will be about real things happening on campus.",
    youWill: [
      "Plan and post content every week",
      "Team up with clubs on posts and giveaways",
      "Track what works, and do more of it",
    ],
    fit: ["You've grown an account or run a club's socials", "You know what UW students are into", "You can write short and funny"],
    questions: [
      { id: "grown", label: "Link an account or campaign you've grown (yours or a club's), and how you did it.", required: true, max: 1500 },
      { id: "pitch", label: "Pitch a post that would make students check DubHub before the weekend.", required: true, max: 1000 },
      LAST_QUESTION,
    ],
  },
];

// Class year choices on the application form.
export const APPLY_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Graduate student", "Alum", "Other"];

// Files people can attach: a resume (required) and a cover letter or portfolio (optional).
export const FILE_TYPES = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};
export const FILE_ACCEPT = ".pdf,.doc,.docx";
export const FILE_LIMITS = { resume: 2 * 1024 * 1024, extra: 1024 * 1024 }; // bytes
