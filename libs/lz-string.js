// Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
// This work is free. You can redistribute it and/or modify it
// under the terms of the WTFPL, Version 2
// For more information see LICENSE.txt or http://www.wtfpl.net/
//
// For more information, the home page:
// http://pieroxy.net/blog/pages/lz-string/testing.html
//
// LZ-based compression algorithm, version 1.4.5
var LZString = (function () {
  // private property
  var i = 0,
    fromCharCode = String.fromCharCode,
    streamData,
    streamDataVal,
    streamDataPosition,
    streamBitsPerChar,
    streamGetCharFromInt,
    emptyString = '',
    reverseDict = {},
    base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+',
    Base64CharArray = (base + '/=').split(emptyString),
    UriSafeCharArray = (base + '-$').split(emptyString);
  while (i < 65) {
    if (i > 62) {
      reverseDict[UriSafeCharArray[i].charCodeAt(0)] = i;
    }
    reverseDict[Base64CharArray[i].charCodeAt(0)] = i++;
  }

  function streamBits(value, numBitsMask) {
    for (var i = 0; numBitsMask >>= 1; i++) {
      // shifting has precedence over bitmasking
      streamDataVal = value >> i & 1 | streamDataVal << 1;
      if (++streamDataPosition === streamBitsPerChar) {
        streamDataPosition = 0;
        streamData.push(streamGetCharFromInt(streamDataVal));
        streamDataVal = 0;
      }
    }
  }

  function getCharFromBase64(a) { return Base64CharArray[a]; }
  function getCharFromURISafe(a) { return UriSafeCharArray[a]; }
  function getCharFromUTF16(a) { return fromCharCode(a + 32); }
  function _node(val) { return { v: val, d: {} }; }
  function _compress(uncompressed, bitsPerChar, getCharFromInt) {
    // data - empty stream
    streamData = [];

    if (uncompressed != null) {
      // davaVal
      streamDataVal = 0;
      // dataPosition
      streamDataPosition = 0;
      streamBitsPerChar = bitsPerChar;
      streamGetCharFromInt = getCharFromInt;
      var j = 0,
        value = 0,
        dictionary = {},
        freshNode = true,
        c = 0,
        node = _node(3), // first node will always be initialised like this.
        getNextValue = uncompressed.charCodeAt.bind(uncompressed),
        nextNode,
        dictSize = 3,
        numBitsMask = 0b100;

      if (uncompressed.length) {
        // If there is a string, the first charCode is guaranteed to
        // be new, so we write it to output stream, and add it to the
        // dictionary. For the same reason we can initialize freshNode
        // as true, and new_node, node and dictSize as if
        // it was already added to the dictionary (see above).

        c = getNextValue(0);

        // == Write first charCode token to output ==

        // 8 or 16 bit?
        value = c < 0x100 ? 0 : 1;

        // insert "new 8/16 bit charCode" token
        // into bitstream (value 1)
        streamBits(value, numBitsMask);
        streamBits(c, value ? 0x10000 : 0x100);

        // Add charCode to the dictionary.
        dictionary[c] = node;

        for (j = 1; j < uncompressed.length; j++) {
          c = getNextValue(j);
          // does the new charCode match an existing prefix?
          nextNode = node.d[c];
          if (nextNode) {
            // continue with next prefix
            node = nextNode;
          } else {
            // Prefix+charCode does not exist in trie yet.
            // We write the prefix to the bitstream, and add
            // the new charCode to the dictionary if it's new
            // Then we set node to the root node matching
            // the charCode.

            if (freshNode) {
              // Prefix is a freshly added character token,
              // which was already written to the bitstream
              freshNode = false;
            } else {
              // write out the current prefix token
              value = node.v;
              streamBits(value, numBitsMask);
            }

            // Is the new charCode a new character
            // that needs to be stored at the root?
            if (dictionary[c] == undefined) {
              // increase token bitlength if necessary
              if (++dictSize >= numBitsMask) {
                numBitsMask <<= 1;
              }

              // insert "new 8/16 bit charCode" token,
              // see comments above for explanation
              value = c < 0x100 ? 0 : 1;
              streamBits(value, numBitsMask);
              streamBits(c, value ? 0x10000 : 0x100);

              dictionary[c] = _node(dictSize);
              // Note of that we already wrote
              // the charCode token to the bitstream
              freshNode = true;
            }
            // add node representing prefix + new charCode to trie
            node.d[c] = _node(++dictSize);
            // increase token bitlength if necessary
            if (dictSize >= numBitsMask) {
              numBitsMask <<= 1;
            }

            // set node to first charCode of new prefix
            node = dictionary[c];
          }
        }

        // === Write last prefix to output ===
        if (freshNode) {
          // character token already written to output
          freshNode = false;
        } else {
          // write out the prefix token
          streamBits(node.v, numBitsMask);
        }

        // Is c a new character?
        if (dictionary[c] == undefined) {
          // increase token bitlength if necessary
          if (++dictSize >= numBitsMask) {
            numBitsMask <<= 1;
          }

          // insert "new 8/16 bit charCode" token,
          // see comments above for explanation
          value = c < 0x100 ? 0 : 1;
          streamBits(value, numBitsMask);
          streamBits(c, 0x100 << value);
        }
        // increase token bitlength if necessary
        if (++dictSize >= numBitsMask) {
          numBitsMask <<= 1;
        }
      }

      // Mark the end of the stream
      streamBits(2, numBitsMask);
      // Flush the last char
      streamDataVal <<= streamBitsPerChar - streamDataPosition;
      streamData.push(streamGetCharFromInt(streamDataVal));
    }
    return streamData;
  }
  function _decompress(length, resetBits, getNextValue) {
    var dictionary = [emptyString, emptyString, emptyString],
      enlargeIn = 4,
      dictSize = 4,
      numBits = 3,
      entry = emptyString,
      result = [],
      bits = 0,
      maxpower = 2,
      power = 0,
      c = emptyString,
      data_val = getNextValue(0),
      data_position = resetBits,
      data_index = 1;

    function getBitStream() {
      while (power != maxpower) {
        // shifting has precedence over bitmasking
        bits += ((data_val >> --data_position) & 1) << power++;
        if (data_position == 0) {
          data_position = resetBits;
          data_val = getNextValue(data_index++);
        }
      }
    }

    // Get first token, guaranteed to be either
    // a new character token (8 or 16 bits)
    // or end of stream token.
    getBitStream();

    // if end of stream token, return empty string
    if (bits == 2) {
      return emptyString;
    }

    // else, get character
    maxpower = bits * 8 + 8;
    bits = power = 0;
    getBitStream();
    c = fromCharCode(bits);
    dictionary[3] = c;
    result.push(c);

    // read rest of string
    while (data_index <= length) {
      // read out next token
      maxpower = numBits;
      bits = power = 0;
      while (power != maxpower) {
        // shifting has precedence over bitmasking
        bits += (data_val >> --data_position & 1) << power++;
        if (data_position == 0) {
          data_position = resetBits;
          data_val = getNextValue(data_index++);
        }
      }

      // 0 or 1 implies new character token
      if (bits < 2) {
        maxpower = 8 + 8 * bits;
        bits = power = 0;
        while (power != maxpower) {
          // shifting has precedence over bitmasking
          bits += (data_val >> --data_position & 1) << power++;
          if (data_position == 0) {
            data_position = resetBits;
            data_val = getNextValue(data_index++);
          }
        }
        dictionary[dictSize] = fromCharCode(bits);
        bits = dictSize++;
        if (--enlargeIn == 0) {
          enlargeIn = 1 << numBits++;
        }
      } else if (bits == 2) {
        // end of stream token
        return result.join(emptyString);
      }

      if (bits > dictionary.length) {
        return null;
      }
      entry = bits < dictionary.length ? dictionary[bits] : c + c.charAt(0);
      result.push(entry);
      // Add c+entry[0] to the dictionary.
      dictionary[dictSize++] = c + entry.charAt(0);

      c = entry;

      if (--enlargeIn == 0) {
        enlargeIn = 1 << numBits++;
      }
    }
    return emptyString;
  }
  function _compressToArray(uncompressed) {
    return _compress(uncompressed, 16, fromCharCode);
  }
  function _decompressFromArray(compressed) {
    if (compressed == null) return emptyString;
    if (compressed.length == 0) return null;
    return _decompress( compressed.length, 16, compressed.charCodeAt.bind(compressed) );
  }

  return {
    compressToBase64: function (input) {
      if (input == null) return emptyString;
      var res = _compress(input, 6, getCharFromBase64),
        i = res.length % 4; // To produce valid Base64
      while (i--) {
        res.push('=');
      }

      return res.join(emptyString);
    },

    decompressFromBase64: function (input) {
      if (input == null) return emptyString;
      if (input == emptyString) return null;
      return _decompress(input.length, 6, function (index) { return reverseDict[input.charCodeAt(index)]; });
    },

    compressToUTF16: function (input) {
      if (input == null) return emptyString;
      var compressed = _compress(input, 15, getCharFromUTF16);
      compressed.push(' ');
      return compressed.join(emptyString);
    },

    decompressFromUTF16: function (compressed) {
      if (compressed == null) return emptyString;
      if (compressed == emptyString) return null;
      return _decompress(compressed.length, 15, function (index) { return compressed.charCodeAt(index) - 32; });
    },

    //compress into uint8array (UCS-2 big endian format)
    compressToUint8Array: function (uncompressed) {
      var compressed = _compressToArray(uncompressed);
      var buf = new Uint8Array(compressed.length * 2); // 2 bytes per character

      for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
        var current_value = compressed[i].charCodeAt(0);
        buf[i * 2] = current_value >>> 8;
        buf[i * 2 + 1] = current_value & 0xFF;
      }
      return buf;
    },

    //decompress from uint8array (UCS-2 big endian format)
    decompressFromUint8Array: function (compressed) {
      if (compressed === null || compressed === undefined) {
        return _decompressFromArray(compressed);
      } else if (compressed.length == 0) {
        return null;
      }
      return _decompress(compressed.length, 8, function (index) { return compressed[index]; });
    },

    //compress into a string that is already URI encoded
    compressToEncodedURIComponent: function (input) {
      if (input == null) return emptyString;
      return _compress(input, 6, getCharFromURISafe).join(emptyString);
    },

    //decompress from an output of compressToEncodedURIComponent
    decompressFromEncodedURIComponent: function (input) {
      if (input == null) return emptyString;
      if (input == emptyString) return null;
      input = input.replace(/ /g, '+');
      return _decompress(input.length, 6, function (index) { return reverseDict[input.charCodeAt(index)]; });
    },

    compress: function (uncompressed) {
      return _compressToArray(uncompressed).join(emptyString);
    },

    compressToArray: _compressToArray,

    decompress: function (compressed) {
      if (compressed == null) return emptyString;
      if (compressed == emptyString) return null;
      return _decompress( compressed.length, 16, compressed.charCodeAt.bind(compressed) );
    },

    decompressFromArray: _decompressFromArray
  };
})();

if (typeof define === 'function' && define.amd) {
  define(function () { return LZString; });
} else if (typeof module !== 'undefined' && module != null) {
  module.exports = LZString;
} else if (typeof angular !== 'undefined' && angular != null) {
  angular.module('LZString', []).factory('LZString', function() { return LZString; });
}
