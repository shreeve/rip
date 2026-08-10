# rip/fake

Rip's own fake data. The distillation of Ruby's faker (102 generator
classes + YAML locale machinery) and ffaker (203 modules + 1.7MB of
data files) down to the screenful a business app actually seeds —
curated inline data, zero dependencies, and values that are
VALID-looking (NANP-legal phones, well-formed emails, real state
codes) so fakes survive real validators.

```rip
import { fake } from 'rip/fake'

fake.firstName 'F'            # 'Emily'        (gendered pools; omit for either)
fake.lastName()               # 'Diaz'
fake.fullName()               # 'Ryan Lee'
fake.email 'Emily', 'Diaz'    # 'emily.diaz@ariamail.example.com'
fake.phone()                  # '(358) 666-0480'   NANP-legal
fake.phone ext: true          # '(304) 917-6241, ext. 1981'
fake.phoneType()              # 'cell' | 'home' | 'work'
fake.fax()                    # same NANP rules
fake.sex()                    # 'M' | 'F'
fake.age 21, 55               # 34
fake.city(); fake.state(); fake.zip(); fake.streetAddress()
fake.company()                # 'Horizon Co'
fake.profession()             # 'Attorney'
fake.jobTitle()               # 'Associate Technician'
fake.date years: [21, 90]     # ISO dob for a 21–90 year old
fake.numerify '###-##-####'   # pattern templating: # = digit
fake.letterify 'rip-???'      # ? = letter; fake.pattern() does both
fake.sample ary               # one element
fake.maybe 0.2, -> fake.nickname()   # value 20% of the time, else null
fake.unique -> fake.email()   # retries until unseen
```

Deterministic when you want it — `fake.seed 42` switches to a seeded
PRNG so tests reproduce byte-for-byte; `fake.seed()` returns to
`Math.random`.

## Model.factory()

Models fabricate themselves through the schema: enum literals are
sampled, `email`/`phone`/`zip`/`uuid` types generate valid shapes,
name heuristics cover plain strings, correlated fields agree
(the email matches the generated name). One polymorphic verb — the
sign says persisted:

```rip
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

A model can declare its own `seed` recipe (an ordinary method
returning an attribute object); it wins over derivation, and a
plain-object argument to factory wins over both.
