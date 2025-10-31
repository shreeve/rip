# Browser Tags - Auto-Execute Rip Code 🎯

Write Rip code directly in your HTML using `<script type="text/rip">` tags!

The `rip/browser` module **automatically detects and executes** any `<script type="text/rip">` tags in your page, while also providing a full programmatic API.

## 🚀 Quick Start

### Step 1: Include the browser module

```html
<script type="module" src="./node_modules/rip/lib/rip/browser.js"></script>
```

### Step 2: Write Rip code anywhere!

```html
<script type="text/rip">
  x = (y for y in [2..5] when y isnt 3)
  console.log 'Result:', x
</script>
```

**That's it!** The Rip code is automatically compiled and executed.

## 📝 Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Rip Browser Tags</title>

  <!-- Include the browser module ONCE -->
  <script type="module" src="./node_modules/rip/lib/rip/browser.js"></script>
</head>
<body>
  <h1>Hello from Rip!</h1>
  <div id="output"></div>

  <!-- Write Rip code! -->
  <script type="text/rip">
    # Array comprehension
    numbers = (x * 2 for x in [1..10] when x % 2 is 0)

    # String interpolation
    message = "Even numbers doubled: #{numbers.join(', ')}"

    # Update the DOM
    document.getElementById('output').textContent = message

    # Console output
    console.log 'Numbers:', numbers
  </script>

  <!-- Multiple script tags work! -->
  <script type="text/rip">
    greet = (name) -> "Hello, #{name}!"
    console.log greet('World')
  </script>
</body>
</html>
```

## ✨ Features

### Multiple Script Tags

You can have as many `<script type="text/rip">` tags as you want:

```html
<script type="text/rip">
  console.log 'First script'
</script>

<script type="text/rip">
  console.log 'Second script'
</script>

<script type="text/rip">
  console.log 'Third script'
</script>
```

They all run automatically in order.

### Custom Filenames

Add `data-filename` for better error messages:

```html
<script type="text/rip" data-filename="my-component.rip">
  class Component
    render: -> '<div>Hello</div>'
</script>
```

Errors will show `my-component.rip` instead of `inline.rip`.

### Async/Await

Async code works perfectly:

```html
<script type="text/rip">
  do ->
    # Fetch data
    response = await fetch('/api/data')!
    data = await response.json()!

    # Update page
    console.log 'Data loaded:', data
</script>
```

### Classes

Define classes inline:

```html
<script type="text/rip">
  class Calculator
    constructor: (@value = 0) ->
    add: (n) -> @value += n; this
    result: -> @value

  calc = new Calculator(10)
  console.log calc.add(5).result()  # 15
</script>
```

### Mix with Regular JavaScript

Regular `<script>` tags still work normally:

```html
<script type="text/rip">
  ripVariable = 'Hello from Rip'
  window.sharedData = { from: 'rip' }
</script>

<script>
  // Regular JavaScript can access Rip variables
  console.log(window.sharedData);
</script>
```

## 🎨 Real-World Example

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="./node_modules/rip/lib/rip/browser.js"></script>
  <style>
    .todo-item { padding: 10px; border: 1px solid #ddd; margin: 5px 0; }
    .done { text-decoration: line-through; opacity: 0.6; }
  </style>
</head>
<body>
  <h1>Todo List</h1>
  <input type="text" id="new-todo" placeholder="Add a todo...">
  <button id="add-btn">Add</button>
  <div id="todos"></div>

  <script type="text/rip" data-filename="todo-app.rip">
    # Todo list app in Rip
    todos = []

    class Todo
      constructor: (@text, @done = false) ->
        @id = Date.now() + Math.random()

      toggle: -> @done = not @done

      toHTML: ->
        className = if @done then 'todo-item done' else 'todo-item'
        """
          <div class="#{className}" data-id="#{@id}">
            <input type="checkbox" #{if @done then 'checked' else ''}>
            <span>#{@text}</span>
            <button class="delete">×</button>
          </div>
        """

    render = ->
      container = document.getElementById('todos')
      container.innerHTML = (todo.toHTML() for todo in todos).join('')

      # Add event listeners
      for item in container.querySelectorAll('.todo-item')
        id = parseFloat(item.dataset.id)
        todo = todos.find (t) -> t.id is id

        item.querySelector('input').onclick = ->
          todo.toggle()
          render()

        item.querySelector('.delete').onclick = ->
          todos = todos.filter (t) -> t.id isnt id
          render()

    # Add new todo
    addTodo = ->
      input = document.getElementById('new-todo')
      text = input.value.trim()
      return unless text

      todos.push new Todo(text)
      input.value = ''
      render()

    # Event listeners
    document.getElementById('add-btn').onclick = addTodo
    document.getElementById('new-todo').onkeypress = (e) ->
      addTodo() if e.key is 'Enter'

    # Initial todos
    todos.push new Todo('Learn Rip')
    todos.push new Todo('Build something cool')
    todos.push new Todo('Share with friends')

    render()
  </script>
</body>
</html>
```

## 🔧 How It Works

1. **Browser module** loads and checks if there are any `<script type="text/rip">` tags
2. **Auto-detects** tags on DOM load (or immediately if DOM is already ready)
3. **Extracts** the Rip source code from each tag
4. **Compiles** it to JavaScript using the Rip compiler
5. **Executes** the compiled JavaScript in global scope
6. **Reports** any errors with helpful messages

**Smart auto-detection:** Only runs if there are actually `<script type="text/rip">` tags present.

## ⚙️ Advanced Usage

### Manual Processing

The browser module exports everything you need for manual control:

```html
<script type="module">
  import { processRipScript, processAllRipScripts } from 'rip/browser'

  // Process a specific script tag
  const script = document.getElementById('my-rip-code')
  processRipScript(script)

  // Or process all tags manually
  document.getElementById('run-btn').onclick = () => {
    processAllRipScripts()
  }
</script>
```

### Mix Auto and Manual

```html
<script type="module" src="rip/browser.js"></script>

<!-- This runs automatically -->
<script type="text/rip">
  console.log 'Auto-executed on load'
</script>

<!-- Also use the programmatic API -->
<script type="module">
  import Rip from 'rip/browser'

  // Manual execution
  document.getElementById('btn').onclick = () => {
    Rip.run(`console.log 'Executed on button click'`)
  }
</script>
```

## 🎯 Use Cases

Perfect for:

- **Quick prototypes** - No build step needed
- **Code playgrounds** - Live coding environments
- **Documentation** - Inline examples that run
- **Learning** - Experiment directly in HTML
- **Interactive demos** - Rip code in presentations

## 🚫 Not Recommended For

- **Production apps** - Use the Bun plugin instead
- **Large codebases** - Compile ahead of time
- **Performance-critical** - Pre-compile for faster load

For production, compile Rip to JavaScript during your build process.

## 📊 Comparison

### Without Browser Tags (Manual)

```html
<script type="module">
  import Rip from 'rip/browser'

  Rip.run(`
    x = (y for y in [2..5] when y isnt 3)
    console.log x
  `)
</script>
```

### With Browser Tags (Auto)

```html
<script type="module" src="rip/browser.js"></script>

<script type="text/rip">
  x = (y for y in [2..5] when y isnt 3)
  console.log x
</script>
```

**Browser Tags = Cleaner, more natural HTML!**

## 📚 Examples

See the `examples/` directory:
- **browser-tags-simple.html** - Minimal example
- **browser-tags-example.html** - Full-featured demo

## 💡 Tips

1. **Include the loader once** in `<head>` or before your Rip scripts
2. **Use `data-filename`** for better error messages
3. **Mix with regular JavaScript** - they work together
4. **Multiple scripts are fine** - they run in order
5. **Async works** - Use `await` freely

## 🎉 That's It!

One script include, unlimited Rip code anywhere in your HTML.

**Simple. Clean. Powerful.** 🚀
