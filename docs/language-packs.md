<img src="assets/logos/rip-icon-512wa.png" style="width:50px;float:left;" /><br>

# Language Packs

**Interchangeable Syntax Definitions for the Universal Runtime**

Language packs are the heart of Rip's universal language platform. These tiny, focused data structures (typically 2KB) contain all the information needed to parse a specific programming language using the universal parser runtime.

## 🌟 **What Are Language Packs?**

### The Revolutionary Approach
Instead of monolithic parsers (200KB+ each), Rip uses minimal language packs that contain only the essential parsing data:

```javascript
// Traditional approach: 200KB parser per language
const CoffeeScriptParser = require('coffeescript-parser'); // 200KB
const PythonParser = require('python-parser');           // 200KB
const JavaScriptParser = require('javascript-parser');   // 200KB

// Rip approach: 2KB language pack + 7KB universal runtime
const CoffeeScriptPack = require('./languages/coffeescript.coffee'); // 2KB
const PythonPack = require('./languages/python.coffee');             // 2KB
const JavaScriptPack = require('./languages/javascript.coffee');     // 2KB

// Same universal runtime for all languages
const UniversalParser = require('./src/parser.coffee'); // 7KB
```

### Language Pack Structure
```javascript
const LanguagePack = {
  // Core parsing data
  symbols: ["Root", "Body", "Expression", "Literal", ...],
  rules: {0: [0, 1], 1: [1, 1], ...},
  states: [{1: [1, 23], 2: [0, 45], ...}, ...],
  
  // AST construction
  actions: {
    0: (rhs) => rhs[0],  // Default: return first child
    1: (rhs) => ({       // Custom AST node
      type: 'Literal',
      value: rhs[0]
    })
  },
  
  // Lexer integration
  createLexer: (input, options) => new MyLanguageLexer(input, options),
  
  // Metadata
  info: {
    name: 'MyLanguage',
    version: '1.0.0'
  }
};
```

## 📦 **Available Language Packs**

### 🎯 **Rip Language Pack** (`languages/rip.coffee`)
**Status**: ✅ **Production Ready**

The default language pack for Rip's modern CoffeeScript-like syntax.

```coffeescript
# Rip language features
greet = (name) ->
  message = "Hello, #{name}!"
  console.log message

# Modern JavaScript features
{name, age} = person
numbers = [1..10]
squares = (x * x for x in numbers)

# Elegant control flow
result = if condition then value else alternative
```

**Features**:
- ✅ Significant whitespace
- ✅ Expression-oriented syntax
- ✅ Template literals
- ✅ Destructuring assignment
- ✅ Array comprehensions
- ✅ Existential operators
- ✅ Modern JavaScript compatibility

### ☕ **CoffeeScript Language Pack** (`languages/coffeescript.coffee`)
**Status**: ✅ **Production Ready**

Full CoffeeScript compatibility with all original features.

```coffeescript
# Classic CoffeeScript syntax
class Animal
  constructor: (@name) ->
  
  speak: ->
    console.log "#{@name} makes a sound"

class Dog extends Animal
  speak: ->
    console.log "#{@name} barks"

dog = new Dog "Rex"
dog.speak()
```

**Features**:
- ✅ Classes and inheritance
- ✅ Function binding (`=>`)
- ✅ Soak operators (`?.`, `?=`)
- ✅ Splats (`...`)
- ✅ Range comprehensions
- ✅ All original CoffeeScript features

### 🐍 **Python Language Pack** (`languages/python.coffee`)
**Status**: 🔄 **In Development**

Python syntax support for the universal runtime.

```python
# Python syntax (future)
def greet(name):
    message = f"Hello, {name}!"
    print(message)

class Animal:
    def __init__(self, name):
        self.name = name
    
    def speak(self):
        print(f"{self.name} makes a sound")

# List comprehensions
squares = [x * x for x in range(10) if x % 2 == 0]
```

**Planned Features**:
- 📋 Indentation-based blocks
- 📋 Function definitions
- 📋 Class definitions
- 📋 List comprehensions
- 📋 Decorators
- 📋 Type hints

### 🟨 **JavaScript Language Pack** (`languages/javascript.coffee`)
**Status**: 📋 **Planned**

Modern JavaScript/TypeScript support.

```javascript
// JavaScript syntax (future)
const greet = (name) => {
  const message = `Hello, ${name}!`;
  console.log(message);
};

class Animal {
  constructor(name) {
    this.name = name;
  }
  
  speak() {
    console.log(`${this.name} makes a sound`);
  }
}

// Async/await
const fetchData = async () => {
  const response = await fetch('/api/data');
  return response.json();
};
```

**Planned Features**:
- 📋 ES6+ syntax
- 📋 Classes and modules
- 📋 Async/await
- 📋 Template literals
- 📋 Destructuring
- 📋 Optional TypeScript support

### 🦀 **Rust Language Pack** (`languages/rust.coffee`)
**Status**: 📋 **Planned**

Rust syntax for systems programming with ownership, pattern matching, and memory safety features.

## 🛠️ **Using Language Packs**

### Basic Usage
```javascript
const UniversalParser = require('./src/parser.coffee');
const ripPack = require('./languages/rip.coffee');
const coffeePack = require('./languages/coffeescript.coffee');

// Create parsers for different languages
const ripParser = new UniversalParser(ripPack);
const coffeeParser = new UniversalParser(coffeePack);

// Parse code in different languages
const ripAst = ripParser.parse('x = 42');
const coffeeAst = coffeeParser.parse('x = 42');
```

### CLI Usage
```bash
# Rip automatically detects language based on file extension
rip my-program.rip      # Uses Rip language pack
rip my-program.coffee   # Uses CoffeeScript language pack
rip my-program.py       # Uses Python language pack (future)
rip my-program.js       # Uses JavaScript language pack (future)
```

### Programmatic Language Selection
```javascript
const rip = require('rip-lang');

// Explicitly specify language pack
const ast = rip.parse(sourceCode, {
  languagePack: require('./languages/coffeescript.coffee')
});

// Or let Rip auto-detect
const ast = rip.parse(sourceCode);
```

## 🔧 **Creating Custom Language Packs**

### Step 1: Define Your Grammar
```coffeescript
# my-language.coffee
module.exports = {
  info: {
    name: 'MyLanguage'
    version: '1.0.0'
  }
  
  # Grammar rules using Rip's elegant format
  grammar: [
    'Expression + Expression' -> Binary '+', $1, $3
    'Expression * Expression' -> Binary '*', $1, $3
    'NUMBER' -> Number $1
    'IDENTIFIER' -> Id $1
  ]
  
  # Operator precedence
  operators: [
    ['left', '+', '-']
    ['left', '*', '/']
  ]
  
  # Custom lexer
  createLexer: (input, options) ->
    return new MyLanguageLexer(input, options)
}
```

### Step 2: Generate Language Pack
```coffeescript
{Generator} = require './rip'

# Load your grammar
grammar = require './my-language.coffee'

# Generate optimized language pack
generator = new Generator()
languagePack = generator.generate(grammar)

# Save the language pack
fs.writeFileSync './languages/my-language.js', languagePack
```

### Step 3: Use Your Language
```javascript
const UniversalParser = require('./src/parser.coffee');
const myLanguagePack = require('./languages/my-language.js');

const parser = new UniversalParser(myLanguagePack);
const ast = parser.parse('5 + 3 * 2');
```

## 📊 **Language Pack Comparison**

| Language | Status | Size | Features | Performance |
|----------|--------|------|----------|-------------|
| **Rip** | ✅ Production | 2KB | Modern CoffeeScript | ⚡ Fast |
| **CoffeeScript** | ✅ Production | 2KB | Full compatibility | ⚡ Fast |
| **Python** | 🔄 Development | 2KB | Core syntax | ⚡ Fast |
| **JavaScript** | 📋 Planned | 2KB | ES6+ features | ⚡ Fast |
| **Rust** | 📋 Planned | 2KB | Systems programming | ⚡ Fast |

## 🌍 **Community Language Packs**

### Contributing New Languages
We welcome community contributions for new language packs! To contribute:

1. **Fork the repository**
2. **Create your language pack** in `languages/your-language.coffee`
3. **Add comprehensive tests** in `test/languages/your-language/`
4. **Update documentation** with usage examples
5. **Submit a pull request**

### Language Pack Guidelines
- **Keep it focused**: 2KB target size
- **Follow conventions**: Use established patterns
- **Include tests**: Comprehensive test coverage
- **Document clearly**: Usage examples and edge cases
- **Optimize performance**: Fast parsing and AST generation

### Example Community Packs
```bash
# Future community language packs
languages/lisp.coffee      # Lisp/Scheme dialect
languages/haskell.coffee   # Functional programming
languages/prolog.coffee    # Logic programming
languages/lua.coffee       # Lightweight scripting
languages/go.coffee        # Concurrent programming
```

## 🚀 **Advanced Features**

### Language Pack Compilation
```bash
# Compile language pack for production
rip compile languages/my-language.coffee

# Optimize for size and performance
rip optimize languages/my-language.js
```

### Language Pack Analysis
```bash
# Analyze grammar conflicts
rip analyze languages/my-language.coffee

# Generate performance report
rip benchmark languages/my-language.js
```

### Cross-Language Interoperability
```coffeescript
# Mix languages in the same project
# main.rip
import {calculate} from './math.py'
import {format} from './utils.js'

result = calculate(42)
formatted = format result
console.log formatted
```

## 📚 **Related Documentation**

- [How It Works](./how-it-works.md) - High-level overview
- [Runtime Engine](./runtime-engine.md) - Universal parser details
- [Grammar Authoring](./grammar-authoring.md) - Creating language packs
- [Quickstart](./quickstart.md) - Getting started guide
- [Migration from CoffeeScript](./migration-coffeescript.md) - Transition guide

---

*Language Packs: Tiny data, infinite possibilities.* 🚀
