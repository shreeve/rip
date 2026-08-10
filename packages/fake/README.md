<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Fake

> **Fake data and Model.factory() — curated, valid-looking, seedable, zero dependencies.**

The distillation of Ruby's faker (102 generator classes + YAML locale
machinery) and ffaker (203 modules + 1.7MB of data files) down to the
screenful a business app actually seeds. Curated inline data, and
values that are VALID-looking — NANP-legal phones, well-formed emails,
real state codes — so fakes survive real validators. Importing the
package also installs `Model.factory()` on every `:model` schema.

**Runtime:** server-side — `factory()` composes with the persistence
runtime; the generators themselves are pure. One `.rip` file.

## Quick Start

```coffee
import { fake } from 'rip/fake'

fake.firstName 'F'            # 'Emily'        (gendered pools; omit for either)
fake.fullName()               # 'Ryan Lee'
fake.email 'Emily', 'Diaz'    # 'emily.diaz@ariamail.example.com'
fake.phone()                  # '(358) 666-0480'   NANP-legal
fake.phone ext: true          # '(304) 917-6241, ext. 1981'
fake.phoneType()              # 'cell' | 'home' | 'work'
fake.fax()                    # same NANP rules
fake.sex()                    # 'M' | 'F'
fake.age 21, 55               # 34
fake.street()                 # 'Elm' | 'Elm St' | 'Elm Peak' — base + type
fake.streetAddress()          # '4280 Willow Ln'
fake.city(); fake.state(); fake.zip()
fake.company()                # 'Horizon Co'
fake.profession()             # 'Attorney'
fake.jobTitle()               # 'Associate Technician'
fake.date years: [21, 90]     # ISO dob for a 21-90 year old
```

## Primitives

Faker's pattern templating, kept — one primitive that mints infinite
custom fakers:

```coffee
fake.numerify '###-##-####'   # '#' -> digit
fake.letterify 'rip-???'      # '?' -> letter
fake.pattern '??-####'        # both
fake.digits 6                 # '493028'
fake.token 20                 # hex token
fake.uuid()                   # v4 shape

fake.sample ary               # one element
fake.chance 0.8               # true 80% of the time
fake.maybe 0.2, -> fake.nickname()   # value 20% of the time, else null
fake.unique -> fake.email()   # retries until unseen, then errors
fake.integer 10, 99
```

Deterministic when you want it — `fake.seed 42` switches to a seeded
PRNG so tests reproduce byte-for-byte; `fake.seed()` returns to
`Math.random`.

## Model.factory()

Models fabricate themselves through their schema: enum literals are
sampled, `email`/`phone`/`zip`/`uuid` types generate valid shapes,
name heuristics cover plain strings, and correlated fields agree —
the email matches the generated name. One polymorphic verb; the sign
says persisted:

```coffee
import 'rip/fake'             # installs Model.factory()

Patient.factory! 5            # five created (persisted)
Patient.factory! 1            # one created
Patient.factory! 0            # one built, unsaved
Patient.factory!(-3)          # three built, unsaved
Patient.factory! 1, partnerId: partner.id    # overrides; FKs are NEVER invented

Test.factory! """
  code   | name                 | price
  005009 | Complete Blood Count | 2800
  322000 | Basic Metabolic      | 4200
"""                           # pipe-table literal: exact rows, all created
```

Attribute precedence, lowest to highest: schema-derived fakes → the
model's own `seed` method (an ordinary method returning an attribute
object, receiving factory's extra arguments) → a plain-object argument
as direct overrides. Fields with declared defaults are left to the
save pipeline, and a required `@belongs_to` foreign key must be passed
explicitly — factories never invent one.

```coffee
export Patient = schema :model
  firstName! string
  lastName!  string
  sex?       "M" | "F"
  dob?       string

  seed: (opts) ->
    sex = opts?.sex ?? fake.sex()
    sex: sex
    firstName: fake.firstName sex
    dob: fake.date years: [21, 90]
```

## Test

```bash
bun run test
```

The suite pins the generator shapes (NANP legality, email form, street
composition), seeded determinism, and the full factory surface: signed
counts, derivation, overrides, seed recipes, pipe tables, and the
foreign-key refusal.
