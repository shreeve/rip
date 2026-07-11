class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return "...";
  }
  describe() {
    return `${this.name} says ${this.speak()}`;
  }
  static kingdom() {
    return "Animalia";
  }
}
class Dog extends Animal {
  constructor(name) {
    super(name);
  }
  speak() {
    return "woof";
  }
  describe() {
    return (super.describe() + "!");
  }
}
class Counter {
  constructor() {
    this.tick = this.tick.bind(this);
    this.n = 0;
  }
  tick() {
    this.n += 1;
    return this.n;
  }
}
let d = new Dog("Rex");
let a = new Animal("Generic");
let c = new Counter();
let s1 = d.speak();
let s2 = d.describe();
let s3 = a.speak();
let k = Animal.kingdom();
let tick = c.tick;
let t1 = tick();
let t2 = tick();
let Maker = class {
  make() {
    return "made";
  }
};
let made = new Maker().make();
let hold = function(x) {
  return x;
};
let Held = hold(class Token {
  kind() {
    return "held";
  }
});
let h = new Held().kind();
let pair = [class L {
}, class R {
}];
let lname = pair[0].name;
let add = function(p, q) {
  return (p + q);
};
class Calc {
  two() {
    return add(1, 1);
  }
  three() {
    return add(1, add(1, 1));
  }
}
let sums = [new Calc().two(), new Calc().three()];