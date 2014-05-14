var Minifier
  , _ = {
      each: require('lodash.foreach')
    , defaults: require('lodash.defaults')
    , bind: require('lodash.bind')
    }
  , concat = require('concat-stream')
  , through = require('through')
  , uglify = require('uglify-js')
  , SM = require('source-map')
  , convertSM = require('convert-source-map')
  , SMConsumer = SM.SourceMapConsumer
  , SMGenerator = SM.SourceMapGenerator;

Minifier = function (opts) {
  /*
  * Handle options/defaults
  */
  opts = opts || {};

  var defaults = {
        minify: true
      , source: 'bundle.js'
      , map: 'bundle.map'
      , compressPaths: function (filePath) {
          // noop
          return filePath;
        }
      };

  this.opts = _.defaults(opts, defaults);

  if(this.opts.map === false)
    this.opts.minify = false;

  /*
  * Instance variables
  */
  this.registry = {}; // Keep source maps and code by file

  /**
  * Browserify runs transforms with a different context
  * but we always want to refer to ourselves
  */
  this.transformer = _.bind(this.transformer, this);

  return this;
};


/*
* Registers maps and code by file
*/
Minifier.prototype.registerMap = function (file, code, map) {
  this.registry[file] = {code:code, map:map};
};

/*
* Gets map by file
*/
Minifier.prototype.mapForFile = function (file) {
  if(!this.fileExists(file)) {
    throw new Error('ENOFILE');
  }

  return this.registry[file].map;
};

/*
* Gets code by file
*/
Minifier.prototype.codeForFile = function (file) {
  if(!this.fileExists(file)) {
    throw new Error('ENOFILE');
  }

  return this.registry[file].code;
};

Minifier.prototype.fileExists = function (file) {
  return (this.registry[file] != null);
}

/*
* Compresses code before Browserify touches it
* Does nothing if minify is false
*/
Minifier.prototype.transformer = function (file) {
  var self = this
    , buffs = []
    , write
    , end
    , throughStream;

  write = function (data) {
    if(self.opts.minify) {
      buffs.push(data);
    }
    else {
      this.queue(data);
    }
  }

  end = function () {
    var unminCode = buffs.join();

    if(self.opts.minify) {
      var min = uglify.minify(unminCode, {
        fromString: true
      , outSourceMap: self.opts.map
      });

      this.queue(min.code);

      self.registerMap(file, unminCode, new SMConsumer(min.map));
    }

    this.queue(null);
  }

  throughStream = through(write, end);

  throughStream.call = function () {
    throw new Error('Transformer is a transform. Correct usage: `bundle.transform(minifier.transformer)`.')
  }

  return throughStream;
};

/*
* Consumes the output stream from Browserify
*/
Minifier.prototype.consumer = function (cb) {
  var self = this;

  return concat(function(data) {
    if(!self.opts.minify) {
      return cb(null, data, null);
    }
    else {
      var bundle;

      try {
        bundle = self.decoupleBundle(data);
      }
      catch(e) {
        if(e.toString() == 'ENOURL') {
          return cb(new Error('Browserify must be in debug mode for minifyify to consume sourcemaps'));
        }
        else {
          return cb(e);
        }
      }

      // Re-maps the browserify sourcemap
      // to the original source using the
      // uglify sourcemap
      bundle.map = self.transformMap(bundle.map);

      bundle.code = bundle.code + '\n//# sourceMappingURL=' + self.opts.map

      cb(null, bundle.code, bundle.map);
    }
  });
};

/*
* Given a SourceMapConsumer from a bundle's map,
* transform it so that it maps to the unminified
* source
*/
Minifier.prototype.transformMap = function (bundleMap) {
  var self = this
    , generator = new SMGenerator({
        file: self.opts.source
      })
      // Map File -> The lowest numbered line in the bundle (offset)
    , bundleToMinMap = {}

      /*
      * Helper function that maps minified source to a line in the browserify bundle
      */
    , mapSourceToLine = function (source, line) {
        var target = bundleToMinMap[source];

        if(!target || target > line) {
          bundleToMinMap[source] = line;
        }
      }

      /*
      * Helper function that gets the line
      */
    , lineForSource = function (source) {
        var target = bundleToMinMap[source];

        if(!target) {
          throw new Error('ENOFILE');
        }

        return target;
      }
    , missingSources = {};

  // Figure out where my minified files went in the bundle
  bundleMap.eachMapping(function (mapping) {
    // Is this a known source?
    if(self.fileExists(mapping.source)) {
      mapSourceToLine(mapping.source, mapping.generatedLine);
    }
    // Not a known source, pass thru the mapping
    else {
      generator.addMapping({
        generated: {
          line: mapping.generatedLine
        , column: mapping.generatedColumn
        }
      , original: {
          line: mapping.originalLine
        , column: mapping.originalColumn
        }
      , source: self.opts.compressPaths(mapping.source)
      , name: mapping.name
      });

      missingSources[mapping.source] = true;
    }
  });

  if(process.env.debug) {
    console.log(' [DEBUG] Here is where Browserify put your modules:');
    _.each(bundleToMinMap, function (line, file) {
      console.log(' [DEBUG] line ' + line + ' "' + self.opts.compressPaths(file) + '"');
    });
  }

  // Add sourceContent for missing sources
  _.each(missingSources, function (v, source) {
    generator.setSourceContent(self.opts.compressPaths(source), bundleMap.sourceContentFor(source));
  });

  // Map from the hi-res sourcemaps to the browserify bundle
  if(process.env.debug) {
    console.log(' [DEBUG] Here is how I\'m mapping your code:');
  }

  self.eachSource(function (file, code) {
    var offset = lineForSource(file) - 1
      , fileMap = self.mapForFile(file)
      , transformedFileName = self.opts.compressPaths(file);

    if(process.env.debug) {
      console.log(' [DEBUG]  Now mapping "' + transformedFileName + '"');
    }

    fileMap.eachMapping(function (mapping) {
      var transformedMapping = self.transformMapping(transformedFileName, mapping, offset);

      if(process.env.debug) {
        console.log(' [DEBUG]  Generated [' + transformedMapping.generated.line +
           ':' + transformedMapping.generated.column + '] > [' +
           mapping.originalLine + ':' + mapping.originalColumn + '] Original');
      }

      generator.addMapping( transformedMapping );
    });

    generator.setSourceContent(transformedFileName, code);
  });

  return generator.toString();
};

/*
* Given a mapping (from SMConsumer.eachMapping)
* return a new mapping (for SMGenerator.addMapping)
* resolved to the original source
*/
Minifier.prototype.transformMapping = function (file, mapping, offset) {
  return {
    generated: {
      line: mapping.generatedLine + offset
    , column: mapping.generatedColumn
    }
  , original: {
      line: mapping.originalLine
    , column: mapping.originalColumn
    }
  , source: file
  , name: mapping.name
  }
};

/*
* Iterates over each code file, executes a function
*/
Minifier.prototype.eachSource = function (cb) {
  var self = this;

  _.each(this.registry, function(v, file) {
    cb(file, self.codeForFile(file), self.mapForFile(file));
  });
};

/*
* Given source with embedded sourcemap, seperate the two
* Returns the code and SourcemapConsumer object seperately
*/
Minifier.prototype.decoupleBundle = function (src) {
  if(typeof src != 'string')
    src = src.toString();

  var map = convertSM.fromSource(src);

  // The source didn't have a sourcemap in it
  if(!map) {
    throw new Error('ENOURL');
  }

  return {
    code: convertSM.removeComments(src)
  , map: new SMConsumer( map.toObject() )
  };
};

module.exports = Minifier;