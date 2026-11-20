/*
 * Modernizr.load -- the one-line glue the Modernizr 2.6.2 download builder appends after the
 * embedded yepnope 1.5.4 when the "load" option is ticked (it is the
 * `Modernizr.load=function(){yepnope.apply(window,[].slice.call(arguments,0));};` line of every
 * 2.6.2 custom build that includes it, and of the game's bundle). MIT/BSD, as Modernizr.
 * Must load after modernizr-2.6.2.js and yepnope-1.5.4.js.
 */
Modernizr.load = function () {
    yepnope.apply(window, [].slice.call(arguments, 0));
};
