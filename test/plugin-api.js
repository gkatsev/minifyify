/* globals jake */

var assert = require('assert')
  , utils = require('utilities')
  , fs = require('fs')
  , path = require('path')
  , jsesc = require('jsesc')
  , validate = require('sourcemap-validator')
  , browserify = require('browserify')
  , fixtures = require('./fixtures')
  , tests = {};

tests['browserify -d -p minifyify --map mapFile > out.js'] = function (next) {

  var appname = 'simple file'
    , mapFile = 'bundle.clied.map.json'
    , browserify = path.join(path.dirname(require.resolve('browserify')), 'bin', 'cmd.js')
    , minifyify = path.join(__dirname, '..', 'lib', 'index.js')
    , outFile = path.join(fixtures.buildDir, 'apps', appname, 'bundle.clied.js')
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile)
    , compressPath = jsesc(path.dirname(fixtures.entryScript(appname)), {quotes: 'double'})
    , cmd = browserify + ' "' + jsesc(fixtures.entryScript(appname), {quotes: 'double'}) +
      // Make sure that the plugin can be used, and we can define the map location
      '" -d -p [ "' + jsesc(minifyify, {quotes: 'double'}) + '" --map ' + mapFile +

      // Make sure that we can accept a string compressPath options
      ' --compressPath "' + compressPath + '"' +

      // Ensure that the output option is respected
      ' --output "' + jsesc(outMapFile, {quotes: 'double'}) + '" ] > "' +
      jsesc(outFile, {quotes: 'double'}) + '"'
    , ex = jake.createExec(cmd)
    , dat = [];

  utils.file.rmRf( path.dirname(outFile) , {silent: true});
  utils.file.mkdirP( path.dirname(outFile) , {silent: true});

  ex.addListener('stdout', function (data) {
    dat.push(data);
  });

  ex.addListener('stderr', function (data) {
    dat.push(data);
  });

  ex.addListener('error', function (err, code) {
    process.stderr.write('Test failed, output:');
    process.stderr.write(dat.join('\n'));
    process.stderr.write(err, code);
    process.exit(code);
  });

  ex.addListener('cmdEnd', function () {
    assert.doesNotThrow(function () {
      var src = fs.readFileSync(outFile).toString()
        , map = fs.readFileSync(outMapFile).toString();

      // Ensures that the map is a valid one
      validate(src, map);

      // This ensures that the mapFile argument appears in the src as the comment
      assert.ok(src.indexOf(mapFile) >= 0, 'The map argument should have been used');

      // If paths were compressed, then this path should never appear in the map
      assert.ok(map.indexOf(compressPath) < 0, 'The compressPath option should have been used');

    }, 'The bundle should have a valid external sourcemap');
    next();
  });

  ex.run();
};

tests['programmatic plugin api'] = function (next) {
  var bundler = new browserify({debug: true});
  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'));
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.doesNotThrow(function () {
      validate(src, map)
    }, 'The bundle should have a valid sourcemap');
    next();
  });
}

tests['programmatic plugin api with --output'] = function (next) {
  var bundler = new browserify({debug: true})
    , appname = 'simple file'
    , mapFile = 'bundle.programmatic.map.json'
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile);

  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'), {output: outMapFile});
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.doesNotThrow(function () {
      // The regular map should be ok
      validate(src, map);

      // The output option should have been respected
      validate(src, fs.readFileSync(outMapFile).toString());

    }, 'The bundle should have a valid sourcemap');
    next();
  });
}

tests['programmatic plugin api with --map and --output'] = function (next) {
  var bundler = new browserify({debug: true})
    , appname = 'simple file'
    , mapFile = 'bundle.programmatic.map.json'
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile);

  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'), {output: outMapFile, map: mapFile});
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.doesNotThrow(function () {
      // The regular map should be ok
      validate(src, map);

      // The output option should have been respected
      validate(src, fs.readFileSync(outMapFile).toString());

    }, 'The bundle should have a valid sourcemap');
    next();
  });
}

tests['programmatic plugin api with minify=false and output'] = function (next) {
  var bundler = new browserify({debug: true})
    , appname = 'simple file'
    , mapFile = 'bundle.programmatic.map.json'
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile);

  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'), {minify:false, output: outMapFile});
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.ok(src)
    assert.equal(map, null, 'There should be no map')
    next();
  });
}

tests['programmatic plugin api with minify=false and compressPath'] = function (next) {
  var bundler = new browserify({debug: true})
    , appname = 'simple file'
    , mapFile = 'bundle.programmatic.map.json'
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile);

  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'), {
    minify: false
  , compressPath: function (p) { return p }
  , output: outMapFile
  });
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.ok(src)
    assert.equal(map, null, 'There should be no map')
    next();
  });
}

tests['programmatic plugin api with minify=false and map'] = function (next) {
  var bundler = new browserify({debug: true})
    , appname = 'simple file'
    , mapFile = 'bundle.programmatic.map.json'
    , outMapFile = path.join(fixtures.buildDir, 'apps', appname, mapFile);

  bundler.add(fixtures.entryScript('simple file'));
  bundler.plugin(require('../lib'), {
    minify: false
  , map: '/turkey.js'
  , output: outMapFile
  });
  bundler.bundle(function (err, src, map) {
    if(err) { throw err; }
    assert.ok(src)
    assert.equal(map, null, 'There should be no map')
    next();
  });
}

module.exports = tests;