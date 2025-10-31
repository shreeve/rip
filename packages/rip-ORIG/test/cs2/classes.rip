# Classes
# -------

# Basic class definition

test "basic class", """
  class Animal
    constructor: -> @type = 'animal'

  new Animal().type
""", 'animal'

test "class with method", """
  class Animal
    speak: -> 'sound'

  new Animal().speak()
""", 'sound'

test "class with constructor parameter", """
  class Animal
    constructor: (@name) ->

  new Animal('Cat').name
""", 'Cat'

# Instance properties

test "instance property", """
  class Animal
    constructor: ->
      @legs = 4

  new Animal().legs
""", 4

test "instance method with this", """
  class Animal
    constructor: -> @sound = 'roar'
    speak: -> @sound

  new Animal().speak()
""", 'roar'

# Class inheritance

test "class inheritance", """
  class Animal
    speak: -> 'sound'

  class Dog extends Animal

  new Dog().speak()
""", 'sound'

test "override method", """
  class Animal
    speak: -> 'sound'

  class Dog extends Animal
    speak: -> 'bark'

  new Dog().speak()
""", 'bark'

test "super call", """
  class Animal
    constructor: (@type) ->

  class Dog extends Animal
    constructor: ->
      super('dog')

  new Dog().type
""", 'dog'

test "super in method", """
  class Animal
    speak: -> 'sound'

  class Dog extends Animal
    speak: -> super() + ' bark'

  new Dog().speak()
""", 'sound bark'

# Static methods

test "static method", """
  class Animal
    @create: -> new Animal()

  Animal.create().constructor.name
""", 'Animal'

test "static property", """
  class Animal
    @count: 0
    constructor: -> Animal.count++

  new Animal()
  new Animal()
  Animal.count
""", 2

# Getters and setters

test "property shorthand", """
  class Person
    constructor: (@name) ->

  new Person('John').name
""", 'John'

test "multiple property shorthand", """
  class Person
    constructor: (@first, @last) ->

  p = new Person('John', 'Doe')
  [p.first, p.last]
""", ['John', 'Doe']

# Class expressions

test "class expression", """
  Animal = class
    speak: -> 'sound'

  new Animal().speak()
""", 'sound'

test "named class expression", """
  Animal = class Beast
    speak: -> 'roar'

  new Animal().speak()
""", 'roar'

# Private methods (convention)

test "private method convention", """
  class Animal
    _private: -> 'secret'
    public: -> @_private()

  new Animal().public()
""", 'secret'

# Method chaining

test "method chaining", """
  class Calculator
    constructor: -> @value = 0
    add: (n) ->
      @value += n
      this
    multiply: (n) ->
      @value *= n
      this

  new Calculator().add(5).multiply(2).value
""", 10

# Bound methods

test "bound method", """
  class Button
    constructor: -> @clicks = 0
    click: => @clicks++

  button = new Button()
  click = button.click
  click()
  click()
  button.clicks
""", 2

# Class with computed property

test "computed property name", """
  methodName = 'dynamicMethod'
  class Test
    [methodName]: -> 'result'

  new Test().dynamicMethod()
""", 'result'

# instanceof

test "instanceof check", """
  class Animal
  class Dog extends Animal

  dog = new Dog()
  dog instanceof Dog
""", true

test "instanceof parent", """
  class Animal
  class Dog extends Animal

  dog = new Dog()
  dog instanceof Animal
""", true

# Constructor return

test "constructor explicit return", """
  class Test
    constructor: ->
      return {custom: true}

  new Test().custom
""", true

# Class prototype

test "prototype property", """
  class Animal
  Animal::speak = -> 'sound'

  new Animal().speak()
""", 'sound'

# Mixins

test "simple mixin", """
  Speakable =
    speak: -> @sound

  class Dog
    constructor: -> @sound = 'bark'

  Object.assign(Dog::, Speakable)
  new Dog().speak()
""", 'bark'

# Class typeof

test "class typeof", """
  class Animal
  typeof Animal
""", 'function'

# Class name property

test "class name", """
  class MyClass
  MyClass.name
""", 'MyClass'

# Empty class

test "empty class", """
  class Empty
  new Empty().constructor.name
""", 'Empty'

# Class with async method

test "async method", """
  class Test
    method: -> await 1

  new Test().method.constructor.name
""", 'AsyncFunction'

# Class with generator method

test "generator method", """
  class Test
    method: ->
      yield 1
      yield 2

  [...new Test().method()]
""", [1, 2]

# Advanced inheritance tests
test "four-level inheritance chain", """
  class Base
    func: (s) -> "base/#{s}"
    @static: (s) -> "static/#{s}"

  class First extends Base
    func: (s) -> super('first/') + s

  class Second extends First
    func: (s) -> super('second/') + s

  class Third extends Second
    func: (s) -> super('third/') + s

  (new Third).func('end')
""", 'base/first/second/third/end'

test "super with accessors", """
  class Base
    m: -> 4
    n: -> 5

  class A extends Base
    m: -> super()
    n: -> super.n()

  a = new A
  a.m() + a.n()
""", 9

test "soaked super invocation", """
  class Base
    method: -> 2

  class A extends Base
    method: -> super?()
    noMethod: -> super?()

  a = new A
  (a.method() ? 0) + (a.noMethod() ? 1)
""", 3

test "varargs constructor", """
  class Connection
    constructor: (one, two, three) ->
      [@one, @two, @three] = [one, two, three]
    out: -> "#{@one}-#{@two}-#{@three}"

  list = [3, 2, 1]
  conn = new Connection list...
  conn.out()
""", '3-2-1'

test "passing arguments to super", """
  class Parent
    method: (args...) -> args.join('-')

  class Child extends Parent
    method: -> super arguments...

  c = new Child
  c.method 1, 2, 3
""", '1-2-3'

test "anonymous class", """
  obj =
    klass: class
      method: -> 'value'

  instance = new obj.klass
  instance.method()
""", 'value'

test "static implicit object", """
  class Static
    @static =
      one: 1
      two: 2

  Static.static.one + Static.static.two
""", 3

test "executable class body", """
  x = 5
  class A
    if x > 3
      b: 'big'
    else
      b: 'small'

  (new A).b
""", 'big'

test "class wrapped in decorator", """
  func = (klass) ->
    klass::prop = 'decorated'
    klass

  func class Test
    prop2: 'original'

  t = new Test
  t.prop + '-' + t.prop2
""", 'decorated-original'

test "bound methods in loops", """
  class Mini
    num: 10
    generate: =>
      for i in [1..3]
        => @num

  m = new Mini
  (func() for func in m.generate()).join('-')
""", '10-10-10'

test "JS keyword properties", """
  class Class
    class: 'class'
    name: -> @class

  instance = new Class
  instance.class + '-' + instance.name()
""", 'class-class'

test "nothing classes", """
  c = class
  c.name
""", ''

test "nested classes", """
  class Outer
    constructor: ->
      @name = 'outer'

    class @Inner
      constructor: ->
        @name = 'inner'

  i = new Outer.Inner
  i.name
""", 'inner'

test "classes in ternary", """
  class A
    val: 'a'
  class B
    val: 'b'

  C = if true then A else B
  (new C).val
""", 'a'

test "super in multiple inheritance levels", """
  class A
    method: -> 'A'

  class B extends A

  class C extends B
    method: -> super() + 'C'

  (new C).method()
""", 'AC'

test "class extends expression", """
  Base = class
    val: 5

  class Child extends Base

  (new Child).val
""", 5

test "namespaced class", """
  obj = {}

  class obj.Klass
    val: -> 'namespaced'

  (new obj.Klass).val()
""", 'namespaced'

test "class with do block", """
  x = 0
  class A
    do -> x = 5

  x
""", 5

test "class with value constructor", """
  makeConstructor = (val) ->
    -> @val = val

  class A
    constructor: makeConstructor(10)

  (new A).val
""", 10

test "super in constructor", """
  class Parent
    constructor: (name) -> @name = name

  class Child extends Parent
    constructor: (name) -> super 'child-' + name

  (new Child('test')).name
""", 'child-test'

test "at symbol referring to instance", """
  class ClassName
    amI: -> @ instanceof ClassName

  obj = new ClassName
  obj.amI()
""", true

test "extends with namespace", """
  class Hive
    constructor: (name) -> @name = name

  class Hive.Bee extends Hive
    constructor: (name) -> super name

  maya = new Hive.Bee 'Maya'
  maya.name
""", 'Maya'

test "implicit super call", """
  class Parent
    constructor: (@val) ->

  class Child extends Parent

  (new Child(42)).val
""", 42

test "class with prototype assignment", """
  class A
  A::val = 10

  (new A).val
""", 10

# ES2015+ interop and advanced features
test "class extends this", """
  class A
    func: -> 'A'

  B = null
  makeClass = ->
    B = class extends @
      func: -> super() + ' B'

  makeClass.call A
  (new B()).func()
""", 'A B'

test "external constructor function", """
  ctor = -> @val = 1
  class A
  class B extends A
    constructor: ctor

  (new B).val
""", 1

test "external constructor with return value", """
  ctor = -> {external: true}
  class A
    constructor: ctor

  (new A).external
""", true

test "bound methods with reserved names", """
  class C
    delete: => 'deleted'

  c = new C
  fn = c.delete
  fn()
""", 'deleted'

test "super with reserved names", """
  class Base
    do: -> 'base'

  class Child extends Base
    do: -> super() + '-child'

  (new Child).do()
""", 'base-child'

test "static super methods", """
  class Parent
    @method: -> 'parent'

  class Child extends Parent
    @method: -> super() + '-child'

  Child.method()
""", 'parent-child'

test "bound static methods keep context", """
  class C
    @boundStatic: => @name

  fn = C.boundStatic
  fn()
""", 'C'

test "classes can extend expressions", """
  id = (x) -> x
  class A
    val: 'a'
  class B extends id A

  (new B).val
""", 'a'

test "passing class definitions as expressions", """
  ident = (x) -> x

  A = ident class then x: 1

  (new A).x
""", 1

test "subclass can set external constructor", """
  ctor = -> @val = 42
  class A
  class B extends A
    constructor: ctor

  (new B).val
""", 42

test "bound functions in bound class methods", """
  class Store
    @bound: =>
      do => @name

  Store.bound()
""", 'Store'

test "class with numeric index method", """
  class B
    0: -> 'zero'

  b = new B
  b[0]()
""", 'zero'

test "constructor with splat return new object", """
  Type = (@args) ->
  type = new Type [1, 2, 3]

  type.args.length
""", 3

test "new against statement", """
  class A
    val: 5

  (new try A).val
""", 5

test "execution order with extends", """
  order = []
  makeFn = (n) ->
    order.push n
    class then val: n

  class B extends (makeFn 1)
    @B: makeFn 2
    constructor: -> super(); makeFn 3

  new B
  order.join(',')
""", '1,2,3'

test "class A extends A special case", """
  class A
    val: 1
  class @A extends A
    val: 2

  (new @A).val
""", 2
