// rip/fake — Rip's own fake-data engine. The distillation of
// faker (102 generators + YAML locale machinery) and ffaker (203
// modules + 1.7MB of data files) down to what seeding and testing
// actually consume: curated inline data, pattern templating, and a
// dozen generators that produce VALID-looking values (NANP-legal
// phones, well-formed emails, real state codes) so fakes survive real
// validators.
//
// Deterministic when you want it: fake.seed(n) switches the module to
// a seeded PRNG (mulberry32) so tests reproduce byte-for-byte;
// fake.seed() returns to Math.random.

// ── randomness ────────────────────────────────────────────────────────

let __rand = Math.random;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seed = (n) => { __rand = n == null ? Math.random : mulberry32(n >>> 0); };

const random  = () => __rand();
const integer = (min = 0, max = 100) => min + Math.floor(__rand() * (max - min + 1));
const sample  = (ary) => ary[Math.floor(__rand() * ary.length)];
const chance  = (prob = 0.5) => __rand() < prob;
const maybe   = (prob, fn) => (__rand() < prob ? (typeof fn === 'function' ? fn() : fn) : null);

// ── pattern templating (faker's numerify/letterify, kept) ─────────────

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const numerify  = (s) => s.replace(/#/g, () => String(integer(0, 9)));
const letterify = (s) => s.replace(/\?/g, () => sample(LETTERS));
const pattern   = (s) => letterify(numerify(s));
const digits    = (n = 6) => numerify('#'.repeat(n));
const token     = (n = 8) => Array.from({ length: n }, () => sample('0123456789abcdef')).join('');
const uuid      = () =>
  pattern('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = integer(0, 15);
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

// ── curated data ──────────────────────────────────────────────────────

const FIRST_M = [
  'James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Joseph',
  'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Andrew',
  'Paul', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald',
  'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric',
  'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel',
];
const FIRST_F = [
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica',
  'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra', 'Ashley',
  'Kimberly', 'Emily', 'Donna', 'Michelle', 'Carol', 'Amanda', 'Dorothy', 'Melissa',
  'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Kathleen', 'Amy',
  'Angela', 'Shirley', 'Anna', 'Brenda', 'Pamela', 'Emma', 'Nicole', 'Helen',
];
const LAST = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
];
const NICK_M = [
  'Bart', 'Biggie', 'Bitsy', 'Chucky', 'Frodo', 'Hawkeye', 'Holmes', 'Homer',
  'Homie', 'Marky', 'Mufasa', 'Romeo', 'Sherlock', 'Simba', 'Snitch', 'Tank', 'Weasel', 'Yoda',
];
const NICK_F = [
  'Apples', 'Barbie', 'Brownie', 'Cherie', 'Chica', 'Daisy', 'Duchess', 'Holly',
  'Jo', 'Peaches', 'Pinky', 'Puma', 'Pumpkin', 'Queen', 'Sparky', 'Twinnie', 'Viola', 'Zee',
];
const STREETS = [
  'Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Park Blvd', 'Washington St',
  'Lake View Dr', 'Sunset Blvd', 'Ridge Rd', 'Hillcrest Ave', 'Meadow Ln', 'River Rd',
  'Highland Ave', 'Forest Dr', 'Willow Way', 'Spring St', 'Franklin Ave', 'Chestnut St',
];
const CITIES = [
  'Springfield', 'Riverside', 'Georgetown', 'Franklin', 'Clinton', 'Fairview',
  'Salem', 'Madison', 'Bristol', 'Clayton', 'Dayton', 'Lexington',
  'Milton', 'Auburn', 'Ashland', 'Burlington', 'Manchester', 'Oxford',
];
const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];
const COMPANIES = [
  'Acme', 'Apex', 'Atlas', 'Beacon', 'Cascade', 'Summit', 'Pinnacle', 'Horizon',
  'Keystone', 'Landmark', 'Meridian', 'Northwind', 'Redwood', 'Sterling', 'Vanguard', 'Zenith',
];
const COMPANY_SUFFIX = ['Labs', 'Group', 'Health', 'Partners', 'Systems', 'Works', 'Co', 'Inc'];
const PROFESSIONS = [
  'Accountant', 'Architect', 'Attorney', 'Carpenter', 'Chef', 'Dentist', 'Electrician',
  'Engineer', 'Firefighter', 'Journalist', 'Librarian', 'Mechanic', 'Nurse', 'Paramedic',
  'Pharmacist', 'Photographer', 'Physician', 'Pilot', 'Plumber', 'Professor',
  'Programmer', 'Scientist', 'Teacher', 'Therapist', 'Veterinarian', 'Welder',
];
const JOB_LEVELS = ['Junior', 'Senior', 'Lead', 'Staff', 'Principal', 'Chief', 'Associate', 'Regional'];
const JOB_ROLES = [
  'Engineer', 'Analyst', 'Manager', 'Director', 'Coordinator', 'Designer',
  'Consultant', 'Administrator', 'Specialist', 'Strategist', 'Technician', 'Officer',
];
const WORDS = [
  'alpha', 'amber', 'apex', 'aria', 'atlas', 'aurora', 'basil', 'birch', 'bloom',
  'brook', 'cedar', 'cinder', 'cloud', 'coral', 'crest', 'delta', 'drift', 'echo',
  'ember', 'fable', 'fern', 'flint', 'gale', 'glade', 'grove', 'harbor', 'haven',
  'iris', 'ivory', 'jade', 'juniper', 'lark', 'lumen', 'maple', 'marsh', 'mesa',
  'nimbus', 'north', 'oasis', 'onyx', 'opal', 'pine', 'quartz', 'raven', 'reef',
  'sage', 'slate', 'summit', 'terra', 'tide', 'vale', 'willow', 'wren', 'zephyr',
];

// ── generators ────────────────────────────────────────────────────────

const firstName = (sex) =>
  sex === 'M' ? sample(FIRST_M) : sex === 'F' ? sample(FIRST_F) : sample(chance() ? FIRST_M : FIRST_F);
const lastName = () => sample(LAST);
const fullName = (sex) => `${firstName(sex)} ${lastName()}`;
const nickname = (sex) =>
  sex === 'M' ? sample(NICK_M) : sex === 'F' ? sample(NICK_F) : sample(chance() ? NICK_M : NICK_F);

const domain = () => `${sample(WORDS)}${sample(['mail', 'box', 'net', 'hub'])}.example.com`;
const email = (first, last) => {
  const f = (first ?? firstName()).toLowerCase().replace(/[^a-z]/g, '');
  const l = (last ?? lastName()).toLowerCase().replace(/[^a-z]/g, '');
  return sample([`${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}${integer(1, 99)}`]) + '@' + domain();
};
const username = (first, last) =>
  `${(first ?? firstName()).toLowerCase()}${(last ?? lastName()).toLowerCase()}${integer(1, 999)}`;

// NANP-legal: area and exchange codes start 2-9, area code never N11.
const areaCode = () => {
  while (true) {
    const n = integer(201, 999);
    if (n % 100 !== 11) return String(n);
  }
};
const exchangeCode = () => String(integer(2, 9)) + digits(2);
const phone = ({ ext = false } = {}) => {
  let s = `(${areaCode()}) ${exchangeCode()}-${digits(4)}`;
  if (ext === true || (typeof ext === 'number' && chance(ext))) s += `, ext. ${integer(50, 3000)}`;
  return s;
};
const fax = () => phone();
const phoneType = () => sample(['cell', 'home', 'work']);

const sex = () => sample(['M', 'F']);
const age = (min = 18, max = 90) => integer(min, max);

const streetAddress = () => `${integer(10, 9950)} ${sample(STREETS)}`;
const city = () => sample(CITIES);
const state = () => sample(STATES);
const zip = () => digits(5);
const company = () => `${sample(COMPANIES)} ${sample(COMPANY_SUFFIX)}`;
const profession = () => sample(PROFESSIONS);
const jobTitle = () => `${sample(JOB_LEVELS)} ${sample(JOB_ROLES)}`;

const word = () => sample(WORDS);
const words = (n = 3) => Array.from({ length: n }, word).join(' ');
const sentence = (n = 8) => {
  const s = words(n);
  return s[0].toUpperCase() + s.slice(1) + '.';
};

// date({years: [21, 55]}) → an ISO date for someone 21–55 years old;
// date({days: 30}) → within the last 30 days; date() → last year.
const MS_DAY = 86400000;
const date = (opts = {}) => {
  let ms;
  if (opts.years) {
    const [a, b] = opts.years;
    ms = Date.now() - integer(a * 365.25 * MS_DAY, b * 365.25 * MS_DAY);
  } else {
    ms = Date.now() - integer(0, (opts.days ?? 365) * MS_DAY);
  }
  return new Date(ms).toISOString().slice(0, 10);
};
const datetime = (opts = {}) => new Date(Date.parse(date(opts)) + integer(0, MS_DAY - 1));

// unique(fn) — retry fn until unseen (per fake.seed epoch), then error.
const __seen = new Map();
const unique = (fn, max = 1000) => {
  const key = fn;
  let set = __seen.get(key);
  if (!set) __seen.set(key, (set = new Set()));
  for (let i = 0; i < max; i++) {
    const v = fn();
    if (!set.has(v)) { set.add(v); return v; }
  }
  throw new Error('fake.unique: exhausted after ' + max + ' retries — pool too small');
};

const fake = {
  seed, random, integer, sample, chance, maybe,
  numerify, letterify, pattern, digits, token, uuid,
  firstName, lastName, fullName, nickname, sex, age,
  email, username, domain, phone, fax, phoneType, areaCode,
  streetAddress, city, state, zip, company, profession, jobTitle,
  word, words, sentence, date, datetime, unique,
};

// ── schema-driven derivation (used by Model.factory) ─────────────────
//
// Given a field descriptor from the schema runtime, produce a
// plausible value. The schema carries the semantics — enum literals,
// email/phone/zip/uuid types, optionality — so most models need no
// per-field recipe at all. Name heuristics cover the string fields
// the type system can't distinguish.

const NAME_HINTS = [
  [/^first_?name$/i, (ctx) => ctx.firstName ?? firstName(ctx.sex)],
  [/^last_?name$/i, (ctx) => ctx.lastName ?? lastName()],
  [/^(full_?)?name$/i, () => (chance(0.5) ? fullName() : company())],
  [/fax/i, () => fax()],
  [/phone_?type/i, () => phoneType()],
  [/phone/i, () => phone()],
  [/email/i, (ctx) => email(ctx.firstName, ctx.lastName)],
  [/profession|occupation/i, () => profession()],
  [/job_?title/i, () => jobTitle()],
  [/(street|address)/i, () => streetAddress()],
  [/city/i, () => city()],
  [/state/i, () => state()],
  [/zip/i, () => zip()],
  [/^(sex|gender)$/i, (ctx) => ctx.sex ?? sample(['M', 'F'])],
  [/^dob|birth/i, () => date({ years: [18, 90] })],
  [/description|notes?$/i, () => sentence()],
  [/^(slug|username)$/i, () => word() + integer(10, 99)],
  [/^(token|secret|key)$/i, () => token(20)],
  [/^(code|number|mrn)$/i, () => digits(6)],
  [/^title$/i, () => words(2)],
  [/company|organization/i, () => company()],
];

function __fakeFieldValue(f, ctx = {}) {
  if (f.literals) return sample(f.literals);
  switch (f.typeName) {
    case 'email': return email(ctx.firstName, ctx.lastName);
    case 'phone': return phone();
    case 'zip': return zip();
    case 'uuid': return uuid();
    case 'url': return 'https://' + domain() + '/' + word();
    case 'boolean': return chance();
    case 'integer': return integer(1, 100);
    case 'number': return Math.round(random() * 10000) / 100;
    case 'date': return date({ days: 365 });
    case 'datetime': return datetime({ days: 365 });
    case 'string':
    case 'text': {
      for (const [re, gen] of NAME_HINTS) {
        if (re.test(f.name) || re.test(f.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))) return gen(ctx);
      }
      return f.typeName === 'text' ? sentence() : words(2);
    }
    default: return undefined;
  }
}

export { fake, __fakeFieldValue };
