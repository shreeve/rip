import * as CoffeeScript from './lib-esm/coffeescript/coffeescript.js';
import fs from 'fs';

const source = fs.readFileSync('src/index.coffee', 'utf8');
try {
  const compiled = CoffeeScript.compile(source, {
    bare: true,
    filename: 'src/index.coffee'
  });
  console.log('Compiled successfully');
  fs.writeFileSync('lib-esm/coffeescript/index.js', compiled);
  console.log('Wrote to lib-esm/coffeescript/index.js');
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
