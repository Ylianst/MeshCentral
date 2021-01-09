/*
Copyright 2018-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

var red = 0xFF;
var yellow = 0xFFFF;
var GXxor = 0x6; //	src XOR dst
var GXclear = 0x0;
var ExposureMask = (1 << 15);

function windows_monitorborder()
{
    this._ObjectID = 'monitor-info';
    var info = require('monitor-info');
    var gm = require('_GenericMarshal');
    var user32 = gm.CreateNativeProxy('user32.dll');
    
    info.monitors = [];
    user32.CreateMethod('GetDC');
    user32.CreateMethod('ReleaseDC');
    user32.CreateMethod('FillRect');
    user32.CreateMethod('InvalidateRect');

    var gdi32 = gm.CreateNativeProxy('gdi32.dll');
    gdi32.CreateMethod('CreateSolidBrush');

    var redBrush = gdi32.CreateSolidBrush(red);
    var yellowBrush = gdi32.CreateSolidBrush(yellow);

    require('events').EventEmitter.call(this);
    this.on('~', function () { this.Stop(); });

    this.Stop = function Stop()
    {
        info.redInterval = null;

        var drawRect = gm.CreateVariable(16);
        var drawRectBuffer = drawRect.toBuffer();

        for (var i in info.monitors)
        {
            // Top
            drawRectBuffer.writeInt32LE(info.monitors[i].left, 0);
            drawRectBuffer.writeInt32LE(info.monitors[i].top, 4);
            drawRectBuffer.writeInt32LE(info.monitors[i].left + (info.monitors[i].right - info.monitors[i].left), 8);
            drawRectBuffer.writeInt32LE(info.monitors[i].bottom - info.monitors[i].top, 12);
            user32.InvalidateRect(0, drawRect, 0);
        }
    }

    this.Start = function Start()
    {
        info.getInfo().then(function (mon)
        {
            var drawRect = gm.CreateVariable(16);

            info.monitors = mon;
            info.dc = user32.GetDC(0);
            info.state = 0;

            info.redInterval = setInterval(function ()
            {
                info.state = (info.state + 1) % 8;

                var drawRectBuffer = drawRect.toBuffer();
                for(var i in info.monitors)
                {
                    drawRectBuffer.writeInt32LE(info.monitors[i].left, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left + (info.monitors[i].right - info.monitors[i].left)/2, 8);
                    drawRectBuffer.writeInt32LE(5, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 0 || info.state == 4) ? yellowBrush : redBrush);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left + (info.monitors[i].right - info.monitors[i].left) / 2, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].right, 8);
                    drawRectBuffer.writeInt32LE(5, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 1 || info.state == 5) ? yellowBrush : redBrush);


                    drawRectBuffer.writeInt32LE(info.monitors[i].right - 5, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].right, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top + (info.monitors[i].bottom - info.monitors[i].top)/2, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 2 || info.state == 6) ? yellowBrush : redBrush);
                    drawRectBuffer.writeInt32LE(info.monitors[i].right - 5, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top + (info.monitors[i].bottom - info.monitors[i].top) / 2, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].right, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 3 || info.state == 7) ? yellowBrush : redBrush);


                    drawRectBuffer.writeInt32LE(info.monitors[i].left + (info.monitors[i].right - info.monitors[i].left) / 2, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom - 5, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].right, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 4 || info.state == 0) ? yellowBrush : redBrush);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom - 5, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left + (info.monitors[i].right - info.monitors[i].left) / 2, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 5 || info.state == 1) ? yellowBrush : redBrush);


                    drawRectBuffer.writeInt32LE(info.monitors[i].left, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top + (info.monitors[i].bottom - info.monitors[i].top) / 2, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left + 5, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].bottom, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 6 || info.state == 2) ? yellowBrush : redBrush);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left, 0);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top, 4);
                    drawRectBuffer.writeInt32LE(info.monitors[i].left + 5, 8);
                    drawRectBuffer.writeInt32LE(info.monitors[i].top + (info.monitors[i].bottom - info.monitors[i].top) / 2, 12);
                    user32.FillRect(info.dc, drawRect, (info.state == 7 || info.state == 3) ? yellowBrush : redBrush);
                }
            }, 450);
        });
    }
}

function linux_monitorborder()
{
    var self = this;
    this.displays = [];
    this._ObjectID = 'monitor-info';
    this._info = require('monitor-info');
    this._isUnity = this._info.isUnity();

    console.log('isUnity = ' + this._isUnity);

    require('events').EventEmitter.call(this);
    this.on('~', function () { this.Stop(); });

    this.Stop = function Stop()
    {
        this._timeout = null;
        if(!this._isUnity)
        {
            for(var i=0; i < this.displays.length; ++i)
            {
                if(this.displays[i].GC1 && this.displays[i].rootWindow)
                {
                    self._info._X11.XSetFunction(self.displays[i].display, self.displays[i].GC1, GXclear);
                    self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, 0, self.displays[i].right, 0);
                    self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, self.displays[i].right, 0, self.displays[i].right, self.displays[i].bottom);
                    self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, self.displays[i].bottom, self.displays[i].right, self.displays[i].bottom);
                    self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, 0, 0, self.displays[i].bottom);

                    this._info._X11.XFlush(this.displays[i].display);
                }
            }
        }
    }
    this.Start = function Start()
    {
        this._info.getInfo().then(function (mon)
        {
            self.displays = mon;
            console.log(mon.length + ' displays');
            for(var i = 0; i<mon.length; ++i)
            {
                console.log('Width: ' + mon[i].right + ', Height: ' + mon[i].bottom);
                mon[i].rootWindow = self._info._X11.XRootWindow(mon[i].display, mon[i].screenId);

                if (self._isUnity)
                {
                    // We are unity, so we have to fake the borders with borderless windows
                    var white = self._info._X11.XWhitePixel(mon[i].display, mon[i].screenId).Val;

                    // Top
                    mon[i].window_top = self._info._X11.XCreateSimpleWindow(mon[i].display, mon[i].rootWindow, 0, 0, mon[i].right, 5, 0, white, white);
                    mon[i].window_top.gc = self._info._X11.XCreateGC(mon[i].display, mon[i].window_top, 0, 0);
                    self._info._X11.XSetLineAttributes(mon[i].display, mon[i].window_top.gc, 10, 0, 1, 1);
                    self._info._X11.XSetSubwindowMode(mon[i].display, mon[i].window_top.gc, 1);
                    self._info.unDecorateWindow(mon[i].display, mon[i].window_top);
                    self._info.setWindowSizeHints(mon[i].display, mon[i].window_top, 0, 0, mon[i].right, 5);

                    // Right
                    mon[i].window_right = self._info._X11.XCreateSimpleWindow(mon[i].display, mon[i].rootWindow, mon[i].right - 5, 0, 5, mon[i].bottom, 0, white, white);
                    mon[i].window_right.gc = self._info._X11.XCreateGC(mon[i].display, mon[i].window_right, 0, 0);
                    self._info._X11.XSetLineAttributes(mon[i].display, mon[i].window_right.gc, 10, 0, 1, 1);
                    self._info._X11.XSetSubwindowMode(mon[i].display, mon[i].window_right.gc, 1);
                    self._info.unDecorateWindow(mon[i].display, mon[i].window_right);
                    self._info.setWindowSizeHints(mon[i].display, mon[i].window_right, mon[i].right - 5, 0, 5, mon[i].bottom);

                    // Left
                    mon[i].window_left = self._info._X11.XCreateSimpleWindow(mon[i].display, mon[i].rootWindow, 0, 0, 5, mon[i].bottom, 0, white, white);
                    mon[i].window_left.gc = self._info._X11.XCreateGC(mon[i].display, mon[i].window_left, 0, 0);
                    self._info._X11.XSetLineAttributes(mon[i].display, mon[i].window_left.gc, 10, 0, 1, 1);
                    self._info._X11.XSetSubwindowMode(mon[i].display, mon[i].window_left.gc, 1);
                    self._info.unDecorateWindow(mon[i].display, mon[i].window_left);
                    self._info.setWindowSizeHints(mon[i].display, mon[i].window_left, 0, 0, 5, mon[i].bottom);

                    // Bottom
                    mon[i].window_bottom = self._info._X11.XCreateSimpleWindow(mon[i].display, mon[i].rootWindow, 0, mon[i].bottom - 5, mon[i].right, 5, 0, white, white);
                    mon[i].window_bottom.gc = self._info._X11.XCreateGC(mon[i].display, mon[i].window_bottom, 0, 0);
                    self._info._X11.XSetLineAttributes(mon[i].display, mon[i].window_bottom.gc, 10, 0, 1, 1);
                    self._info._X11.XSetSubwindowMode(mon[i].display, mon[i].window_bottom.gc, 1);
                    self._info.unDecorateWindow(mon[i].display, mon[i].window_bottom);
                    self._info.setWindowSizeHints(mon[i].display, mon[i].window_bottom, 0, mon[i].bottom - 5, mon[i].right, 5);

                    self._info._X11.XMapWindow(mon[i].display, mon[i].window_top);
                    self._info._X11.XMapWindow(mon[i].display, mon[i].window_right);
                    self._info._X11.XMapWindow(mon[i].display, mon[i].window_left);
                    self._info._X11.XMapWindow(mon[i].display, mon[i].window_bottom);

                    self._info.setAlwaysOnTop(mon[i].display, mon[i].rootWindow, mon[i].window_top);
                    self._info.hideWindowIcon(mon[i].display, mon[i].rootWindow, mon[i].window_top);
                    self._info.setAlwaysOnTop(mon[i].display, mon[i].rootWindow, mon[i].window_right);
                    self._info.hideWindowIcon(mon[i].display, mon[i].rootWindow, mon[i].window_right);
                    self._info.setAlwaysOnTop(mon[i].display, mon[i].rootWindow, mon[i].window_left);
                    self._info.hideWindowIcon(mon[i].display, mon[i].rootWindow, mon[i].window_left);
                    self._info.setAlwaysOnTop(mon[i].display, mon[i].rootWindow, mon[i].window_bottom);
                    self._info.hideWindowIcon(mon[i].display, mon[i].rootWindow, mon[i].window_bottom);

                    self._info._X11.XFlush(mon[i].display);
                    mon[i].borderState = 0;
                }
                else
                {
                    // If we aren't unity, then we can just draw
                    mon[i].GC1 = self._info._X11.XCreateGC(mon[i].display, mon[i].rootWindow, 0, 0);
                    mon[i].borderState = 0;

                    self._info._X11.XSetForeground(mon[i].display, mon[i].GC1, self._info._X11.XWhitePixel(mon[i].display, mon[i].screenId).Val); // White
                    self._info._X11.XSetLineAttributes(mon[i].display, mon[i].GC1, 10, 0, 1, 1);
                    self._info._X11.XSetSubwindowMode(mon[i].display, mon[i].GC1, 1);
                }
            }
            self._info._XEvent = self._info._gm.CreateVariable(192);
            self._timeout = setTimeout(self._isUnity ? self.unity_drawBorder : self.timeoutHandler, 250);
        });
    }

    this.timeoutHandler = function()
    {
        for (var i = 0; i < self.displays.length; ++i) {
            self.displays[i].borderState = (self.displays[i].borderState + 1) % 8;

            // Top
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 0 || self.displays[i].borderState == 4) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, 0, self.displays[i].right / 2, 0);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 1 || self.displays[i].borderState == 5) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, self.displays[i].right / 2, 0, self.displays[i].right, 0);

            // Right
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 2 || self.displays[i].borderState == 6) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, self.displays[i].right, 0, self.displays[i].right, self.displays[i].bottom / 2);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 3 || self.displays[i].borderState == 7) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, self.displays[i].right, self.displays[i].bottom / 2, self.displays[i].right, self.displays[i].bottom);

            // Bottom
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 5 || self.displays[i].borderState == 1) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, self.displays[i].bottom, self.displays[i].right / 2, self.displays[i].bottom);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 4 || self.displays[i].borderState == 0) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, self.displays[i].right / 2, self.displays[i].bottom, self.displays[i].right, self.displays[i].bottom);

            // Left
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 7 || self.displays[i].borderState == 3) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, 0, 0, self.displays[i].bottom / 2);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].GC1, (self.displays[i].borderState == 6 || self.displays[i].borderState == 2) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].rootWindow, self.displays[i].GC1, 0, self.displays[i].bottom / 2, 0, self.displays[i].bottom);


            self._info._X11.XFlush(self.displays[i].display);
        }
        self._timeout = setTimeout(self._isUnity ? self.unity_drawBorder : self.timeoutHandler, 400);
    }
    this.unity_drawBorder = function unity_drawBorder()
    {
        for (var i = 0; i < self.displays.length; ++i)
        {
            self.displays[i].borderState = (self.displays[i].borderState + 1) % 8;

            // Top
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_top.gc, (self.displays[i].borderState == 0 || self.displays[i].borderState == 4) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_top, self.displays[i].window_top.gc, 0, 0, self.displays[i].right / 2, 0);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_top.gc, (self.displays[i].borderState == 1 || self.displays[i].borderState == 5) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_top, self.displays[i].window_top.gc, self.displays[i].right / 2, 0, self.displays[i].right, 0);
            self._info._X11.XFlush(self.displays[i].display);

            // Right
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_right.gc, (self.displays[i].borderState == 2 || self.displays[i].borderState == 6) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_right, self.displays[i].window_right.gc, 0, 0, 0, self.displays[i].bottom / 2);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_right.gc, (self.displays[i].borderState == 3 || self.displays[i].borderState == 7) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_right, self.displays[i].window_right.gc, 0, self.displays[i].bottom / 2, 0, self.displays[i].bottom);
            self._info._X11.XFlush(self.displays[i].display);

            // Bottom
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_bottom.gc, (self.displays[i].borderState == 5 || self.displays[i].borderState == 1) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_bottom, self.displays[i].window_bottom.gc, 0, 0, self.displays[i].right / 2, 0);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_bottom.gc, (self.displays[i].borderState == 4 || self.displays[i].borderState == 0) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_bottom, self.displays[i].window_bottom.gc, self.displays[i].right / 2, 0, self.displays[i].right, 0);
            self._info._X11.XFlush(self.displays[i].display);

            // Left
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_left.gc, (self.displays[i].borderState == 7 || self.displays[i].borderState == 3) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_left, self.displays[i].window_left.gc, 0, 0, 0, self.displays[i].bottom / 2);
            self._info._X11.XSetForeground(self.displays[i].display, self.displays[i].window_left.gc, (self.displays[i].borderState == 6 || self.displays[i].borderState == 2) ? 0xffff00 : 0xff0000);
            self._info._X11.XDrawLine(self.displays[i].display, self.displays[i].window_left, self.displays[i].window_left.gc, 0, self.displays[i].bottom / 2, 0, self.displays[i].bottom);
            self._info._X11.XFlush(self.displays[i].display);
        }
        self._timeout = setTimeout(self._isUnity ? self.unity_drawBorder : self.timeoutHandler, 400);
    }
}

switch(process.platform)
{
    case 'win32':
        module.exports = new windows_monitorborder();
        break;
    case 'linux':
        module.exports = new linux_monitorborder();
        break;
    default:
        break;
}







