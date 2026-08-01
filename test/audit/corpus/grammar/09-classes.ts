// 09-classes.ts — the twin oracle for 09-classes.rip.
// Two new-spines are deliberately omitted here as on the rip side: neither `new a?.b` nor `new tag"x"` emits a runnable spelling (FINDINGS.md).

// ── Named declarations: the empty class, and the bodyless extends ──

class Marker {}

class SubMarker extends Marker {}

let bare = new Marker()

console.log('markers:', bare instanceof Marker, new SubMarker() instanceof Marker)

// ── The full named shape: fields, constructor, methods, statics ──

class Animal {
  name: string
  legs: number = 4

  constructor(name: string = 'generic') {
    this.name = name
  }

  speak() {
    return 'generic'
  }

  describe() {
    return `${this.name} says ${this.speak()}`
  }

  static kingdom: string = 'Animalia'

  static found() {
    return new this()
  }
}

let generic = Animal.found()

console.log('animal:', generic.describe(), generic.legs, Animal.kingdom)

// ── Anonymous classes: bare, bodied, and the extends pair ──

let Blank = class {}

let Tagged = class {
  tag: string = 'anon'
}

let Grown = class extends Marker {}

let Refined = class extends Tagged {
  note: string = 'refined'
}

console.log('anonymous:', new Blank() instanceof Blank, new Tagged().tag, new Grown() instanceof Marker, new Refined().note)

// ── Static inner classes: the @-targeted declaration forms ──

class Shelf {
  static Box = class {
    label: string = 'box'
  }

  static Bin = class extends Shelf.Box {
    lidded: boolean = true
  }
}

console.log('shelf:', new Shelf.Box().label, new Shelf.Bin().lidded, new Shelf.Bin().label)

// ── Subclassing: constructor super(), and method super in every form ──

class Dog extends Animal {
  constructor(name: string) {
    super(name)
  }

  speak() {
    return 'woof'
  }

  describe() {
    return super.describe() + '!'
  }

  formal() {
    return super.describe().toUpperCase()
  }

  keyed() {
    return super['speak']()
  }

  tall() {
    return super['describe']()
  }
}

let rex = new Dog('Rex')

console.log('dog:', rex.describe(), rex.formal(), rex.keyed(), rex.tall())

// ── New spines: member, index, parenthetical, this-property, super ──

let blueprints = { marker: Marker, animal: Animal }
let viaDot = new blueprints.marker()
let viaIndex = new blueprints['marker']()
let viaParen = new (blueprints.animal)('Via')
let nested = { inner: blueprints }
let mintClass = (parts: TemplateStringsArray) => class Minted {
  label() { return parts[0] }
}
let viaSoak = new (blueprints?.marker ?? undefined)()
let viaSoakCall = new (blueprints?.animal ?? undefined)('Soaked')
let viaSoakBelow = new (nested?.inner.marker ?? undefined)()
let viaSoakIndex = new (nested?.inner['marker'] ?? undefined)()
let viaTag = new (mintClass`minted`)()

console.log('spines:', viaDot instanceof Marker, viaIndex instanceof Marker, viaParen.name)
console.log('soaks:', viaSoak instanceof Marker, viaSoakCall.name, viaSoakBelow instanceof Marker, viaSoakIndex instanceof Marker)
console.log('tag:', viaTag.label(), (new (mintClass`chained`)()).label())

class Kennel {
  Tenant: typeof Dog = Dog

  adopt(name: string) {
    return new this.Tenant(name)
  }
}

class Crate extends Shelf {
  static unbox() {
    return new super.Box()
  }
}

console.log('kept:', new Kennel().adopt('Fido').name, Crate.unbox().label)

// ── Construction dammit: the construction itself is the awaited call ──

class Ticket {
  serial: number = 0

  constructor(serial: number = 1) {
    this.serial = serial
  }
}

let instant = await new Ticket()
let numbered = await new Ticket(7)

console.log('tickets:', instant.serial, numbered.serial)

// ── Nested construction: `new new` through a class-minting constructor ──

class Chick {
  chirp: string = 'peep'
}

class Hatchery {
  constructor() {
    return Chick
  }
}

// the cast records what TypeScript cannot express: this constructor genuinely returns a class, so constructing it yields a constructor
let Hatch = Hatchery as new () => new () => { chirp: string }
let hatched = new (new Hatch())()
let mints = { hatch: Hatch }
let hatchedSoak = new (new (mints?.hatch ?? undefined)())()

console.log('hatched:', hatched.chirp, hatchedSoak.chirp)

// ── Prototype access: the `::` read, and the `?::` soak when the target may be absent ──

const speaker = Animal.prototype.speak

function speakerOf(maybe: typeof Animal | undefined) {
  return maybe?.prototype.speak
}

console.log('prototype:', typeof speaker, typeof speakerOf(Animal), speakerOf(undefined))

// ── An exported class rides the same declaration form ──

export class Shipped {
  version: number = 4
}

console.log('shipped:', new Shipped().version)
