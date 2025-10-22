/**
 * @description Enhanced Lightweight annotation UI for Android agent (id=14).
 *              Provides a local overlay for freehand drawing + shapes that mirrors
 *              to the agent via meshuser `action:'annotation'`.
 * @author Maximus
 * @version v0.2.0
 */

(function () {
  // --- Context that can be injected by the host page ---
  const ctx = {
    getCurrentNode: () => (typeof window !== 'undefined' ? window.currentNode : null),
    send: (o) => {
      try {
        if (typeof window !== 'undefined' && window.meshserver && typeof meshserver.send === 'function') {
          meshserver.send(o);
        }
      } catch (_) { /* no-op */ }
    },
    getViewer: () => (typeof window !== 'undefined' ? (window.webRtcDesktop?.softdesktop || window.desktop) : null),
    getCanvas: () => {
      if (typeof document === 'undefined') return null;
      return document.getElementById('Desk') || document.getElementById('DeskMonitor') || null;
    }
  };

  const makeRO = (fn) => {
    if (typeof ResizeObserver !== 'undefined') return new ResizeObserver(fn);
    return { observe: fn, disconnect: function(){} };
  };

  const MESHRIGHT_REMOTECONTROL = 0x00000008;
  const MESHRIGHT_REMOTEVIEW    = 0x40000000;

  // --- The enhanced module ---
  const Anno = {
    // Existing state
    _boundViewer: null,
    _boundCanvas: null,
    _overlay: null,
    _cleanup: null,
    _ro: null,
    _stroke: null,
    _strokes: [],
    _active: false,
    _color: '#215587',
    _width: 15,
    DEFAULT_TTL: 5000,
    _supported: null,
    _probeTried: Object.create(null),

    // Enhanced state for tools and shapes
    _currentTool: 'pen',
    _shapes: [],
    _activeShape: null,
    _isDrawingShape: false,
    _ttlMode: 5000,
    _shapeStartPoint: null,
    _selectedShape: null,
    _dragMode: null, // 'move' | 'resize'
    _dragOffset: { x: 0, y: 0 },

    // TTL options
    _ttlOptions: [0, 5000, 10000, 15000, 20000], // 0=permanent, then 5s,10s,15s,20s
    _currentTtlIndex: 1, // default to 5s

    //Eraser options
    _isErasing: false,
    //Trotthle for eraser
    _lastEraseTime: 0,
    // ColorPicker options 
    _colorPickerOpen: false,
    _activeColorInput: null,
    _colorPickerJustClosed: false,
    _isMobile: false,
    // -------- Public API --------
    init() {
      if (!window._annoPatchedServerAction && typeof window !== 'undefined') {
        const prev = window.serverAction || function(){};
        window.serverAction = function (msg, ws) {
          try {
            if (msg && msg.action === 'annotationAck') {
              try { Anno._onAnnoAck(msg); } catch (_) {}
            }
            if (msg && msg.action === 'event' && msg.event) {
              if (msg.event.action === 'changenode' && msg.event.node) {
                Anno.updateNodeContext(msg.event.node);
              }
            }
          } catch {}
          return prev.apply(this, arguments);
        };
        window._annoPatchedServerAction = true;
      }

      const node = ctx.getCurrentNode?.();
      if (node && node._id) { try { this._probeOnce(node._id); } catch(_){} }
      if (node) this.updateNodeContext(node);
      this._updateTtlIndicator();
      this._updateColorSelection();
    },

    setColor(hex) {
      this._color = hex;
      if (this._overlay) {
        const ctx2d = this._overlay.getContext('2d');
        ctx2d.strokeStyle = this._color;
      }
      if (this._stroke) this._stroke.color = this._color;

      const node = ctx.getCurrentNode?.();
      if (node && node._id) {
        this._send({ action:'annotation', nodeids:[node._id], op:'style', color:this._color, width:this._width });
      }
    },

    setWidth(w) {
      w = Math.max(1, w|0);
      this._width = w;

      const node = ctx.getCurrentNode?.();
      if (this._overlay) {
        const scale = this._scaleFactor(this._overlay);
        const c = this._overlay.getContext('2d');
        c.lineWidth = this._width * scale;
      }
      if (this._stroke) this._stroke.width = this._width * this._scaleFactor(this._overlay);

      if (node && node._id) {
        this._send({ action:'annotation', nodeids:[node._id], op:'style', color:this._color, width:this._width });
      }
    },

    setTtl(ms) { 
      this.DEFAULT_TTL = Math.max(0, ms|0); 
      this._ttlMode = this.DEFAULT_TTL;
    },

    setContext(opts) {
      if (!opts || typeof opts !== 'object') return;
      if (opts.getCurrentNode) ctx.getCurrentNode = opts.getCurrentNode;
      if (opts.send) ctx.send = opts.send;
      if (opts.getViewer) ctx.getViewer = opts.getViewer;
      if (opts.getCanvas) ctx.getCanvas = opts.getCanvas;
    },

    _scaleFactor(ov) {
      const { w: rw, h: rh } = this._remoteSize();
      if (!ov || !rw || !rh) return 1;
      const r = ov.getBoundingClientRect();
      const sx = r.width / rw;
      return (sx > 0 && isFinite(sx)) ? sx : 1;
    },

    hookDesktop(viewer) { this._bind({ viewer, canvasEl: ctx.getCanvas() }); },
    hookSoftDesktop(viewer) { this._bind({ viewer, canvasEl: ctx.getCanvas() }); },
    bind({ canvasEl, viewer }) { this._bind({ canvasEl, viewer }); },
    unhook() { this._unbind(); },

    updateNodeContext(node, connectivity, meshrights) {
      try {
        if (!node || !node.agent || node.agent.id !== 14) {
          this._supported = null;
          return;
        }

        const caps = (node && node.caps) || {};
        const cap = caps.annotation;

        if (cap === true) {
          this._supported = true;
        } else if (cap === false) {
          this._supported = false;
        } else {
          this._supported = null;
          if (node && node._id && !this._probeTried[node._id]) {
            this._probeTried[node._id] = true;
            this._probeOnce(node._id);
          }
        }

        const img = E('DeskAnnotateButtonImage');
        if (img && node && typeof node.annotationPermission === 'string') {
          img.title = (node.annotationPermission === 'granted')
            ? 'Annotate (permission granted)'
            : 'Annotate (device will request overlay permission)';
        }
      } catch {}
    },

    _probeOnce(nodeid) {
      try { this._send({ action:'annotation', nodeids:[nodeid], op:'probe', responseid:'ui-anno-probe' }); } catch(_){}
    },

    _onAnnoAck(msg) {
      // Auto-detect if data is wrapped in event structure
      let eventData;
      if (msg.action === 'event' && msg.event) {
          eventData = msg.event;
      } else if (msg.action === 'annotationAck') {
          eventData = msg;
      } else {
          console.warn('[AnnotationUI] Unexpected message format:', msg);
          return;
      }
	  
      if (!eventData || !eventData.nodeid) return;

      // Handle capability/support responses (from probe)
      if (typeof eventData.supported === 'boolean') {
         this._supported = eventData.supported;
         if (typeof updateDesktopButtons === 'function') updateDesktopButtons();
      }

      // Handle permission status updates
      if (typeof eventData.permission === 'string') {
         const node = ctx.getCurrentNode?.();
         if (node) {
            node.annotationPermission = eventData.permission;
            const img = document.getElementById('DeskAnnotateButtonImage');
            if (img) {
    	       img.title = (eventData.permission === 'granted')
	       ? 'Annotate (permission granted)'
	       : 'Annotate (device will request overlay permission)';
	    }
	 }
      }

      // Handle operation responses (start, stop, probe, etc.)
      if (eventData.op && typeof eventData.ok === 'boolean') {
         if (eventData.ok) {
            //console.log(`[AnnotationUI] Operation ${eventData.op} succeeded`);
            // Handle specific successful operations
            if (eventData.op === 'start') {
    	       //console.log('[AnnotationUI] Annotation service started successfully');
	    }
         } else {
            console.warn(`[AnnotationUI] Operation ${eventData.op} failed:`, eventData.error || 'Unknown error');
            // Could show user notification for critical failures
         }
      }

      // Handle event messages (from Android service lifecycle)
      if (eventData && eventData.op === 'event' && typeof eventData.event === 'string') {
         //console.log('Event received: ' + eventData.event);
         switch (eventData.event) {
            case 'stopped':
	        if (this._active) {
		  this._disableDrawMode();
	    }
	    break;

	    case 'started':
	    break;

	    case 'permission_granted':
		const node = ctx.getCurrentNode?.();
		if (node) {
		  node.annotationPermission = 'granted';
		  const img = document.getElementById('DeskAnnotateButtonImage');
		  if (img) {
		    img.title = 'Annotate (permission granted)';
		  }
		}
	    break;

	    case 'permission_denied':
		const node2 = ctx.getCurrentNode?.();
		if (node2) {
		  node2.annotationPermission = 'denied';
		  const img = document.getElementById('DeskAnnotateButtonImage');
		  if (img) {
		    img.title = 'Annotate (device will request overlay permission)';
		  }
		}
	    break;

	    case 'error':
		console.warn('[AnnotationUI] Android error:', eventData.error || 'Unknown error');
	    break;

	    default:
		console.log('[AnnotationUI] Unknown event:', eventData.event);
		break;
	    }
       }
    },

    toggle() {
      const node = ctx.getCurrentNode?.();
      if (!node || !node._id) {
        alert('Open a device desktop first.');
        return;
      }
      if (this._supported !== true) return;
      if (!this._active) {
        this._send({ action:'annotation', nodeids:[node._id], op:'start', responseid:'ui-anno-start' });
        this._enableDrawMode();
      } else {
        this._send({ action:'annotation', nodeids:[node._id], op:'stop', responseid:'ui-anno-stop' });
        this._disableDrawMode();
      }
    },

    isActive() { return !!this._active; },

    // -------- Menu Functions --------
    toggleAnnotateMenu() {
      QV('annotationMenu', (QS('annotationMenu').display == 'none'));
      if(this._isMobile){
         this.mobileMenu();
      }
    },

    showMenu() {
      QV('annotationMenu', true);
    },

    hideMenu() {
      QV('annotationMenu', false);
    },
   
    mobileMenu(){
      if (Q('annotationMenu')) QS('annotationMenu').width = 'auto';
      if (Q('mainMenuSection')) QC('mainMenuSection').add('mobileAnnoMenuFix'); 
      if (Q('ttlIndicator')) {
        QC('ttlIndicator').remove('ttl-indicator');
        QC('ttlIndicator').add('ttl-indicator-mobile');
      }
      if (Q('ttltoolssection')) {
         const style = QS('ttltoolssection');
         style.width = 'auto';
         style.paddingLeft = '30%';
      }
    },
   
    setMobileMode(isMobile) {
      this._isMobile = isMobile;
    },

    selectAnnotationTool(toolType) {
      const tools = ['pen', 'rectangle', 'circle', 'arrow', 'eraser', 'colorpicker', 'timer', 'clear'];
      const newTool = tools[toolType - 1] || 'pen';

      // Special handling for colorpicker - don't change current tool
      if (newTool === 'colorpicker') {
         this._showColorPicker();
         return;
      }

      // Special handling for timer - don't change current tool, just show TTL options
      if (newTool === 'timer') {
         this._showTtlOptions();
         return;
      }

      // Clear any active shape when switching tools
      this._activeShape = null;
      this._selectedShape = null;
 
      this._currentTool = newTool;
      this._updateCursor();
      this._updateToolButtons();


      this.hideMenu();
    },

    clearAnnotations() {
      const node = ctx.getCurrentNode?.();
      if (node && node._id) {
        this._send({ action:'annotation', nodeids:[node._id], op:'clear' });
      }
      // Clear local state
      this._strokes = [];
      this._shapes = [];
      this._activeShape = null;
      this._selectedShape = null;
      if (this._overlay) {
        const ctx2d = this._overlay.getContext('2d');
        ctx2d.clearRect(0, 0, this._overlay.width, this._overlay.height);
      }
      this.hideMenu();
    },

    // -------- Tool Helper Functions --------
    _updateCursor() {
      if (!this._overlay) return;
      
      const cursors = {
        pen: 'url("images/pen24.png") 3 21, crosshair',
        rectangle: 'crosshair',
        circle: 'crosshair', 
        arrow: 'crosshair',
        eraser: 'url("images/icon-eraser24.png") 12 12, crosshair'
      };
      
      this._overlay.style.cursor = cursors[this._currentTool] || 'crosshair';
    },

    _updateToolButtons() {
      // Update visual state of tool buttons (you can implement this based on your CSS)
      const tools = ['pen', 'rectangle', 'circle', 'arrow', 'eraser', 'colorpicker', 'timer'];
      tools.forEach((tool, index) => {
        const btn = document.getElementById(`annoToolButton${index + 1}`);
        if (btn) {
          if (tool === this._currentTool) {
            btn.classList.add('selected');
          } else {
            btn.classList.remove('selected');
          }
        }
      });
    },

    _showTtlOptions() {
      const menu = document.getElementById('annotationMenu');
      if (menu) menu.classList.add('ttl-active');
    
      // Update selected state
      this._updateTtlSelection();
    },

    _showMainMenu() {
      const menu = document.getElementById('annotationMenu');
      if (menu) menu.classList.remove('ttl-active');
    
      this._updateToolButtons();
    },

    _setTtlOption(index) {
      this._currentTtlIndex = parseInt(index);
      this._ttlMode = this._ttlOptions[this._currentTtlIndex];
    
      this._updateTtlIndicator();
      this._updateTtlSelection();
    
      // Auto-return to main menu after selection
      setTimeout(() => this._showMainMenu(), 200);
    },

    _updateTtlSelection() {
      // Clear all selected states
      for (let i = 0; i < 5; i++) {
         const option = document.getElementById(`ttlOption${i}`);
         if (option) option.classList.remove('selected');
      }
    
      // Set current selection
      const current = document.getElementById(`ttlOption${this._currentTtlIndex}`);
      if (current) current.classList.add('selected');
    },

    _updateTtlIndicator() {
      const indicator = document.getElementById('ttlIndicator');
      if (indicator) {
        const labels = ['∞', '5s', '10s', '15s', '20s'];
        indicator.textContent = labels[this._currentTtlIndex];
      }
    },

    // -------- Color Picker Options ---- 
    _showColorPicker() {
        if (this._colorPickerOpen) {
	    this._closeColorPicker();
	    return;
	}

	if (this._colorPickerJustClosed) {
	    return;
        }

	const colorButton = document.getElementById('annoToolButton6');
	if (!colorButton) return;

	this._colorPickerOpen = true;
	const rect = colorButton.getBoundingClientRect();
	  
	const colorInput = document.createElement('input');
	colorInput.type = 'color';
	colorInput.value = this._color;
	colorInput.style.position = 'absolute';
	colorInput.style.left = (rect.right + 10) + 'px';
	colorInput.style.top = rect.top + 'px';
	colorInput.style.zIndex = '25';
	colorInput.style.opacity = '0.01';
	colorInput.style.width = '1px';
	colorInput.style.height = '1px';
	colorInput.style.border = 'none';
	colorInput.style.outline = 'none';

	// Store handler references for cleanup
	const changeHandler = (e) => {
	    const newColor = e.target.value;
	    this.setColor(newColor);
	    this._addColorToPresets(newColor);
	    this._updateColorSelection();
	    this._closeColorPicker(true);
	};
	  
	const blurHandler = () => {
	    this._closeColorPicker();
	};

	colorInput._changeHandler = changeHandler;
	colorInput._blurHandler = blurHandler;
	  
	colorInput.addEventListener('change', changeHandler);
	colorInput.addEventListener('blur', blurHandler);

	this._activeColorInput = colorInput;

	document.body.appendChild(colorInput);
	  setTimeout(() => {
	    if (document.body.contains(colorInput)) {
	      colorInput.click();
	    }
	  }, 10);
    },

    _closeColorPicker(fromColorSelection = false) {
        if (this._activeColorInput && document.body.contains(this._activeColorInput)) { 
	    this._activeColorInput.removeEventListener('change', this._activeColorInput._changeHandler);
	    this._activeColorInput.removeEventListener('blur', this._activeColorInput._blurHandler);
	    document.body.removeChild(this._activeColorInput);
	}
	this._activeColorInput = null;
	this._colorPickerOpen = false;
	  
	// If closed from color selection, prevent immediate reopening
	if (fromColorSelection) {
	    this._colorPickerJustClosed = true;
	    setTimeout(() => {
	      this._colorPickerJustClosed = false;
	    }, 200); // 200ms delay
	  }
    },

    _addColorToPresets(newColor) {
        // Add to first position and shift others right
	const colorsSection = document.querySelector('.annoColorsSection');
	if (!colorsSection) return;
	  
	// Remove any existing custom color preset
	const existingCustom = colorsSection.querySelector('.custom-color');
	if (existingCustom) {
	    existingCustom.remove();
	}
	  
	// Create new custom color preset
	const customPreset = document.createElement('div');
	customPreset.className = 'annoColorPreset custom-color';
	customPreset.style.background = newColor;
	customPreset.style.order = '-1'; // Put it first
	customPreset.title = 'Custom color';
	customPreset.onclick = () => this.selectAnnotationColor(newColor);
	  
	colorsSection.insertBefore(customPreset, colorsSection.firstChild);
    },

    _updateColorSelection() {
	  // Remove previous selection indicators
	document.querySelectorAll('.annoColorPreset').forEach(preset => {
	    preset.classList.remove('selected-color');
	});
	  
	// Find and highlight current color
	document.querySelectorAll('.annoColorPreset').forEach(preset => {
	    const bgColor = preset.style.background;
	    // Convert rgb to hex if needed for comparison
	    if (this._colorsMatch(bgColor, this._color)) {
	      preset.classList.add('selected-color');
	    }
	  });
     },

     _colorsMatch(color1, color2) {
	// Simple color matching - could be more sophisticated
	if (color1 === color2) return true;
	  
	// Handle rgb() to hex conversion if needed
	if (color1.startsWith('rgb')) {
	    const rgbMatch = color1.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
	    if (rgbMatch) {
	      const hex = '#' + 
		parseInt(rgbMatch[1]).toString(16).padStart(2, '0') +
		parseInt(rgbMatch[2]).toString(16).padStart(2, '0') +
		parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
	      return hex.toLowerCase() === color2.toLowerCase();
	    }
	  }
	  
	  return color1.toLowerCase() === color2.toLowerCase(); 
     },

     selectAnnotationColor(colorHex) {
	  this.setColor(colorHex);
	  this._updateColorSelection();
	  this.hideMenu();
     },

    // -------- Internal helpers --------
    _send(o) { try { ctx.send(o); } catch(_){} },

    _bind({ canvasEl, viewer }) {
      this._boundCanvas = canvasEl || ctx.getCanvas();
      this._boundViewer = viewer || ctx.getViewer();

      if (!this._boundCanvas) {
        console.warn('[AnnotationUI] No viewer canvas found to bind.');
        return;
      }
    },

    _unbind() {
      this._disableDrawMode();
      this._boundViewer = null;
      this._boundCanvas = null;
    },

    _remoteSize() {
      const v = this._boundViewer || ctx.getViewer?.();
      const w = (v && v.m && v.m.width) || (v && v.width) || 0;
      const h = (v && v.m && v.m.height) || (v && v.height) || 0;
      return { w, h };
    },

    _ensureOverlay() {
      const vc = this._boundCanvas || ctx.getCanvas?.();
      if (!vc) return null;

      if (!this._overlay) {
        const ov = document.createElement('canvas');
        ov.id = 'AnnoOverlay';
        ov.style.position = 'absolute';
        ov.style.pointerEvents = 'auto';
        ov.style.zIndex = '20';
        ov.style.cursor = 'url("images/pen24.png") 3 21, crosshair';
        ov.oncontextmenu = (e) => { e.preventDefault(); return false; };
	
        const ctx2d = ov.getContext('2d');
        ctx2d.imageSmoothingEnabled = true;
        ctx2d.imageSmoothingQuality = 'high';
        ctx2d.lineJoin = 'round';
        ctx2d.lineCap = 'round';	

        const p = vc.parentNode;
        if (p && getComputedStyle(p).position === 'static') p.style.position = 'relative';
        p.appendChild(ov);
        this._overlay = ov;

        const applyRect = () => {
          const r = vc.getBoundingClientRect();
          const cs = getComputedStyle(vc);
          const left = vc.offsetLeft - parseFloat(cs.borderLeftWidth || '0');
          const top = vc.offsetTop - parseFloat(cs.borderTopWidth || '0');

          ov.style.left = left + 'px';
          ov.style.top = top + 'px';
          ov.width = Math.max(1, Math.round(r.width));
          ov.height = Math.max(1, Math.round(r.height));
          ov.style.width = r.width + 'px';
          ov.style.height = r.height + 'px';
        };

        this._ro = makeRO(() => { applyRect(); this._redrawAll(); });
        try { this._ro.observe(vc); } catch {}
        applyRect();
        this._redrawAll();
      }

      return this._overlay;
    },

    _redrawCommitted() {
        if (!this._overlay) return;
	const ctx2d = this._overlay.getContext('2d');
	ctx2d.clearRect(0, 0, this._overlay.width, this._overlay.height);
	    
	// Draw committed strokes
	for (const s of this._strokes) {
	    ctx2d.save();
	    ctx2d.strokeStyle = s.color;
	    ctx2d.lineWidth = s.width;
	    ctx2d.lineJoin = 'round';
	    ctx2d.lineCap = 'round';
	    ctx2d.beginPath();
	    const f = s.pts[0];
	    ctx2d.moveTo(f.x, f.y);
	    for (let i = 1; i < s.pts.length; i++) {
	      const p = s.pts[i];
	      ctx2d.lineTo(p.x, p.y);
	    }
	    ctx2d.stroke();
	    ctx2d.restore();
	}

	// Draw committed shapes
	for (const shape of this._shapes) {
	    this._drawShape(ctx2d, shape);
	  }
    },

    _redrawAll() {
      this._redrawCommitted();
      
      // Draw active stroke
      if (this._overlay && this._stroke) {
        const ctx2d = this._overlay.getContext('2d');
        ctx2d.save();
        ctx2d.strokeStyle = this._stroke.color;
        ctx2d.lineWidth = this._stroke.width;
        ctx2d.lineJoin = 'round';
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        const f = this._stroke.pts[0];
        ctx2d.moveTo(f.x, f.y);
        for (let i = 1; i < this._stroke.pts.length; i++) {
          const p = this._stroke.pts[i];
          ctx2d.lineTo(p.x, p.y);
        }
        ctx2d.stroke();
        ctx2d.restore();
      }

      // Draw active shape being created
      if (this._overlay && this._activeShape) {
        const ctx2d = this._overlay.getContext('2d');
        this._drawShape(ctx2d, this._activeShape, true);
      }
    },

    _drawShape(ctx2d, shape, isPreview = false) {
	  ctx2d.save();
	  ctx2d.strokeStyle = shape.color;
	  ctx2d.lineWidth = shape.width;
	  ctx2d.lineJoin = 'round';
	  ctx2d.lineCap = 'round';

	  if (isPreview) {
	    ctx2d.setLineDash([3, 3]); // Shorter dashes for smoother preview
	  }

	  ctx2d.beginPath();

	  switch (shape.type) {
	    case 'rectangle':
	      // Fix coordinate normalization - always use top-left to bottom-right
	      const x = Math.min(shape.x1, shape.x2);
	      const y = Math.min(shape.y1, shape.y2);
	      const w = Math.abs(shape.x2 - shape.x1);
	      const h = Math.abs(shape.y2 - shape.y1);
	      this._drawRoundedRect(ctx2d, x, y, w, h, 10);
	      break;

	    case 'circle':
	      const radius = Math.sqrt(Math.pow(shape.x2 - shape.x1, 2) + Math.pow(shape.y2 - shape.y1, 2));
	      ctx2d.arc(shape.x1, shape.y1, radius, 0, 2 * Math.PI);
	      break;

	    case 'arrow':
	      this._drawArrow(ctx2d, shape.x1, shape.y1, shape.x2, shape.y2);
	      break;
      }

      ctx2d.stroke();
      ctx2d.restore();
    },

    _drawRoundedRect(ctx2d, x, y, w, h, radius) {
      // Ensure positive dimensions
      if (w <= 0 || h <= 0) return;
	  
      // Limit radius to half the smaller dimension
      radius = Math.min(radius, Math.min(w, h) / 2);
	  
      ctx2d.moveTo(x + radius, y);
      ctx2d.lineTo(x + w - radius, y);
      ctx2d.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx2d.lineTo(x + w, y + h - radius);
      ctx2d.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx2d.lineTo(x + radius, y + h);
      ctx2d.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx2d.lineTo(x, y + radius);
      ctx2d.quadraticCurveTo(x, y, x + radius, y);
    },
    _drawArrow(ctx2d, x1, y1, x2, y2) {
      // Main line
      ctx2d.moveTo(x1, y1);
      ctx2d.lineTo(x2, y2);
      
      // Arrow head
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 20;
      const headAngle = Math.PI / 6;
      
      ctx2d.moveTo(x2, y2);
      ctx2d.lineTo(
        x2 - headLen * Math.cos(angle - headAngle),
        y2 - headLen * Math.sin(angle - headAngle)
      );
      
      ctx2d.moveTo(x2, y2);
      ctx2d.lineTo(
        x2 - headLen * Math.cos(angle + headAngle),
        y2 - headLen * Math.sin(angle + headAngle)
      );
    },

    _pruneAndRedraw() {
      if (!this._overlay) return;
      const now = Date.now();
      if (this._strokes.length) {
        const keep = [];
        let changed = false;
        for (const s of this._strokes) {
          if (!s.deathAt || s.deathAt > now) keep.push(s); 
          else changed = true;
        }
        if (changed) this._strokes = keep;
      }
      
      // Prune shapes too
      if (this._shapes.length) {
        const keep = [];
        let changed = false;
        for (const s of this._shapes) {
          if (!s.deathAt || s.deathAt > now) keep.push(s); 
          else changed = true;
        }
        if (changed) this._shapes = keep;
      }
      
      this._redrawAll();
    },

    _enableDrawMode() {
      if (this._active) return;

      const ov = this._ensureOverlay();
      if (!ov) { alert('Viewer is not ready yet.'); return; }

      const node = ctx.getCurrentNode?.();
      if (!node || !node._id) { alert('Open a device desktop first.'); return; }
      
      const ctx2d = ov.getContext('2d');
      ctx2d.lineJoin = 'round';
      ctx2d.lineCap = 'round';
      const scale = this._scaleFactor(ov);
      ctx2d.lineWidth = this._width * scale;
      ctx2d.strokeStyle = this._color;

      this._send({ action:'annotation', nodeids:[node._id], op:'style', color: this._color, width: this._width });

      const toRemote = (clientX, clientY) => {
        const r = ov.getBoundingClientRect();
        const { w:rw, h:rh } = this._remoteSize();
        if (!rw || !rh) return [0, 0];
        const x = (clientX - r.left) * (rw / r.width);
        const y = (clientY - r.top) * (rh / r.height);
        return [Math.max(0, Math.round(x)), Math.max(0, Math.round(y))];
      };

      const coords = (e) => {
        const rect = ov.getBoundingClientRect();
        const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
        const cx = (touch ? touch.clientX : e.clientX);
        const cy = (touch ? touch.clientY : e.clientY);
        const lx = Math.max(0, Math.min(rect.width, cx - rect.left));
        const ly = Math.max(0, Math.min(rect.height, cy - rect.top));
        return { cx, cy, lx, ly };
      };

      const start = (e) => {
        e.preventDefault();
        const { cx, cy, lx, ly } = coords(e);

        if (this._currentTool === 'pen') {
          // Existing pen logic
          ctx2d.strokeStyle = this._color;
          ctx2d.lineWidth = this._width * scale;
          this._stroke = { pts: [{ x: lx, y: ly }], width: this._width * scale, color: this._color };
          ctx2d.beginPath(); 
          ctx2d.moveTo(lx, ly);

          const [rx, ry] = toRemote(cx, cy);
          this._send({ action:'annotation', nodeids:[node._id], op:'strokeStart', x: rx, y: ry });
          
        } else if (['rectangle', 'circle', 'arrow'].includes(this._currentTool)) {
          // Shape creation
          this._isDrawingShape = true;
          this._shapeStartPoint = { x: lx, y: ly };
          this._activeShape = {
            type: this._currentTool,
            x1: lx, y1: ly,
            x2: lx, y2: ly,
            color: this._color,
            width: this._width * scale
          };
          
        } else if (this._currentTool === 'eraser') {
          // Eraser logic - find and remove shape/stroke at point
           this._isErasing = true; // Add this flag to Anno object
          this._eraseAtPoint(lx, ly);
        }
      };

      const move = (e) => {
        if (!this._stroke && !this._isDrawingShape && !this._isErasing) return;
        e.preventDefault();
        const { cx, cy, lx, ly } = coords(e);

        if (this._currentTool === 'pen' && this._stroke) {
          // Existing pen logic
          ctx2d.strokeStyle = this._stroke.color;
          ctx2d.lineWidth = this._stroke.width;
          this._stroke.pts.push({ x: lx, y: ly });
          ctx2d.lineTo(lx, ly); 
          ctx2d.stroke();

          const [rx, ry] = toRemote(cx, cy);
          this._send({ action:'annotation', nodeids:[node._id], op:'strokeMove', x: rx, y: ry });
          
        }else if (this._currentTool === 'eraser' && this._isErasing) {
          this._eraseAtPoint(lx, ly);
         } 
	 else if (this._isDrawingShape && this._activeShape) {
          // Update shape end point
          this._activeShape.x2 = lx;
          this._activeShape.y2 = ly;
          this._redrawAll();
        }
      };

      const end = (e) => {
        if (!this._stroke && !this._isDrawingShape && this._currentTool !== 'eraser') return;
        e && e.preventDefault();

        if (this._currentTool === 'pen' && this._stroke) {
          // Existing pen logic
          const ttl = this._ttlMode;
          const stroke = this._stroke;
          this._stroke = null;

          this._send({ action:'annotation', nodeids:[node._id], op:'strokeEnd', ttlMs: ttl });

          if (ttl > 0) {
            stroke.deathAt = Date.now() + ttl;
          }
          this._strokes.push(stroke);

          if (ttl > 0) setTimeout(() => this._pruneAndRedraw(), ttl);
          
        }
	else if (this._currentTool === 'eraser') {
          this._isErasing = false;
        } 
	else if (this._isDrawingShape && this._activeShape) {
          // Finalize shape
          const shape = this._activeShape;
          this._activeShape = null;
          this._isDrawingShape = false;
          
          // Send shape to Android
          this._sendShapeToAndroid(shape);
          
          // Store locally with TTL
          const ttl = this._ttlMode;
          if (ttl > 0) {
            shape.deathAt = Date.now() + ttl;
          }
          this._shapes.push(shape);
          
          if (ttl > 0) setTimeout(() => this._pruneAndRedraw(), ttl);
          this._redrawAll();
        }
      };

      // Attach listeners
      ov.addEventListener('mousedown', start);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
      ov.addEventListener('touchstart', start, { passive: false });
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', end);

      this._cleanup = () => {
        ov.removeEventListener('mousedown', start);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', end);
        ov.removeEventListener('touchstart', start);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', end);
      };

      this._active = true;
      this._updateCursor();
      Q('DeskAnnotateButtonImage').src = 'images/icon-annotate-tool-red.png';
      QV('DeskAnnotateMenuButton', true);
    },

    _sendShapeToAndroid(shape) {
      const node = ctx.getCurrentNode?.();
      if (!node || !node._id) return;
	  
      const { w: rw, h: rh } = this._remoteSize();
      if (!rw || !rh) return;
	  
      const ov = this._overlay;
      const r = ov.getBoundingClientRect();
	  
      // Convert local coordinates to remote coordinates (like the working version)
      const x1 = (shape.x1 / r.width) * rw;
      const y1 = (shape.y1 / r.height) * rh;
      const x2 = (shape.x2 / r.width) * rw;
      const y2 = (shape.y2 / r.height) * rh;
	  
      let message;
      switch (shape.type) {
          case 'rectangle':
              const w = Math.abs(x2 - x1);
	      const h = Math.abs(y2 - y1);
	      message = {
		action: 'annotation',
		nodeids: [node._id],
		op: 'rect',
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		w: w,
		h: h,
		ttlMs: this._ttlMode
	      };
	      break;
	      
	  case 'circle':
	      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
	      message = {
		action: 'annotation',
		nodeids: [node._id],
		op: 'circle',
		cx: x1,  // meshuser.js converts x -> cx for circles
		cy: y1,  // meshuser.js converts y -> cy for circles
		r: radius,
		ttlMs: this._ttlMode
	      };
	      break;
	      
	  case 'arrow':
	      message = {
		action: 'annotation',
		nodeids: [node._id],
		op: 'arrow',
		x: x1,   // meshuser.js expects x, y, x2, y2 (not x1, y1)
		y: y1,
		x2: x2,
		y2: y2,
		ttlMs: this._ttlMode
	      };
	      break;
      }
	  
      if (message) {
          this._send(message);
	  }
      },

    _eraseAtPoint(x, y) {
      const now = Date.now();
      if (this._isErasing && now - this._lastEraseTime < 50) return; // 50ms throttle
      this._lastEraseTime = now;
	  
      let erased = false;
          const node = ctx.getCurrentNode?.();

      // Check shapes first
      for (let i = this._shapes.length - 1; i >= 0; i--) {
	  const shape = this._shapes[i];
	    
	  if (this._pointInShape(x, y, shape)) {
	      this._shapes.splice(i, 1);
	      erased = true;
	      break;
	    }
      }

      // Check strokes if no shape was erased
      if (!erased) {
         for (let i = this._strokes.length - 1; i >= 0; i--) {
             const stroke = this._strokes[i];
      
             if (this._pointInStroke(x, y, stroke)) {
		this._strokes.splice(i, 1);
		erased = true;
		break;
	      }
	    }
	  }

      if (erased && node && node._id) {
	 // Clear everything on Android
	 this._send({ 
	      action: 'annotation', 
	      nodeids: [node._id], 
	      op: 'clear'
	 });
	    
	 // Redraw remaining shapes to Android
	 for (const shape of this._shapes) {
	     this._sendShapeToAndroid(shape);
	 }
	    
	 // Redraw remaining strokes to Android (need to implement this)
	 for (const stroke of this._strokes) {
	     this._sendStrokeToAndroid(stroke);
	 }
	    
	 // Redraw browser overlay
	    this._redrawAll();
      }
    },

    _sendStrokeToAndroid(stroke) {
       const node = ctx.getCurrentNode?.();
       if (!node || !node._id || !stroke.pts.length) return;

       const { w: rw, h: rh } = this._remoteSize();
       if (!rw || !rh) return;

       const ov = this._overlay;
       const r = ov.getBoundingClientRect();

       // Convert stroke points to remote coordinates
       const remotePoints = stroke.pts.map(pt => [
	    (pt.x / r.width) * rw,
	    (pt.y / r.height) * rh
       ]);

       // Send as a path to Android
       this._send({
	    action: 'annotation',
	    nodeids: [node._id],
	    op: 'path',
	    points: remotePoints,
	    ttlMs: 0 // No TTL for re-sent strokes
	  });
    },

    _pointInShape(x, y, shape) {
        const tolerance = 20; // Increased from 10 to 20 pixels
	switch (shape.type) {
	    case 'rectangle':
	      const inRect = x >= Math.min(shape.x1, shape.x2) - tolerance &&
		     x <= Math.max(shape.x1, shape.x2) + tolerance &&
		     y >= Math.min(shape.y1, shape.y2) - tolerance &&
		     y <= Math.max(shape.y1, shape.y2) + tolerance;
	      return inRect;

	    case 'circle':
	      const radius = Math.sqrt(Math.pow(shape.x2 - shape.x1, 2) + Math.pow(shape.y2 - shape.y1, 2));
	      const dist = Math.sqrt(Math.pow(x - shape.x1, 2) + Math.pow(y - shape.y1, 2));
	      const inCircle = Math.abs(dist - radius) <= tolerance;
	      return inCircle;

	    case 'arrow':
	      const inArrow = this._pointToLineDistance(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= tolerance;
	      return inArrow;
	  }
	  return false;
    },

    _pointInStroke(x, y, stroke) {
        const tolerance = Math.max(stroke.width / 2, 15); // Increased minimum tolerance
	  
	  for (let i = 0; i < stroke.pts.length - 1; i++) {
	    const p1 = stroke.pts[i];
	    const p2 = stroke.pts[i + 1];
	    const dist = this._pointToLineDistance(x, y, p1.x, p1.y, p2.x, p2.y);
	    if (dist <= tolerance) {
	      return true;
	    }
	  }
	  return false;
    },

    _pointToLineDistance(x, y, x1, y1, x2, y2) {
      const A = x - x1;
      const B = y - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      
      if (lenSq === 0) return Math.sqrt(A * A + B * B);
      
      let t = Math.max(0, Math.min(1, dot / lenSq));
      
      const projX = x1 + t * C;
      const projY = y1 + t * D;
      
      return Math.sqrt(Math.pow(x - projX, 2) + Math.pow(y - projY, 2));
    },

    _disableDrawMode() {
      if (!this._active) return;
      this._closeColorPicker();
      try { this._cleanup && this._cleanup(); } catch {}
      this._cleanup = null;
      this._strokes = [];
      this._shapes = [];
      this._activeShape = null;
      this._selectedShape = null;
      
      if (this._overlay) {
        try {
          const p = this._overlay.parentNode;
          if (p) p.removeChild(this._overlay);
        } catch {}
      }
      this._overlay = null;

      if (this._ro && this._ro.disconnect) {
        try { this._ro.disconnect(); } catch {}
      }
      this._ro = null;

      this._stroke = null;
      this._active = false;
      Q('DeskAnnotateButtonImage').src = 'images/icon-annotate-tool.png';
      QV('DeskAnnotateMenuButton', false);
    }
  };

  // Expose globally
  window.AnnotationUI = Anno;
  
  (function bootstrap() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { Anno.init(); });
    } else {
      Anno.init();
    }
  })();
})();
