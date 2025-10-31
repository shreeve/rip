Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname === '/' ? '/examples/browser-tags-example.html' : url.pathname
    return new Response(Bun.file('.' + path))
  }
})

console.log('🚀 Server running at http://localhost:3000')
console.log('📄 Examples:')
console.log('   http://localhost:3000/examples/browser-tags-example.html')
console.log('   http://localhost:3000/examples/browser-tags-simple.html')
console.log('   http://localhost:3000/examples/browser-example.html')