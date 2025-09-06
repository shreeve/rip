#!/bin/bash

echo "Unifying to ESM-only approach..."

# 1. Remove old CJS lib directory
echo "Removing CJS lib directory..."
rm -rf lib/

# 2. Move lib-esm to lib
echo "Moving lib-esm to lib..."
mv lib-esm lib

# 3. Clean up duplicate CLI files
echo "Cleaning up CLI files..."
cd bin
rm -f *.cjs cake.js coffee.js
mv coffee-esm.js coffee
mv cake-esm.js cake
chmod +x coffee cake
cd ..

# 4. Update package.json to point to the right files
echo "Updating package.json..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.main = './lib/coffeescript/index.js';
pkg.bin = {
  coffee: './bin/coffee',
  cake: './bin/cake'
};
pkg.directories.lib = './lib/coffeescript';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

echo "Done! Now using unified ESM approach."
