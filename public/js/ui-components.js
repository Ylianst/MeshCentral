/**
 * Reusable UI Components
 * This file contains reusable JavaScript components that can be used across the application
 *
 * default3.handlebars current state (as of 2026-03-02) contains:
 * - 256 `setModalContent(...)` calls
 * - 243 `showModal(...)` calls
 * each modal set/show pair can be reduced to 1 `openModal(...)` after migration to these components, resulting in a potential reduction of ~200 lines of code in default3.handlebars.
 *
 * Biggest gain first:
 * - Standardize modal invocation through reusable helpers in this file,
 *   then migrate repeated modal calls in default3.handlebars.
 * - Expected code reduction in default3.handlebars, and ensures lower duplication risk.
 *
 * More UI components can be added here, or moved to a dedicated components directory over time (one component per file) as needed.
 */

// Modern Modal Component
class ModernModal {
    constructor(modalId, options = {}) {
        this.modalId = modalId;
        this.options = {
            size: 'medium',
            showCloseButton: true,
            backdrop: true,
            keyboard: true,
            ...options
        };
    }

    show(title, content, okCallback = null, okButtonText = 'OK') {
        const sizeClass = this.options.size === 'large' ? 'modal-lg' :
                         this.options.size === 'extra-large' ? 'modal-xl' : '';

        let modalContent = `
            <div class="modal-dialog modal-dialog-centered ${sizeClass}">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        ${this.options.showCloseButton ? '<button type="button" class="btn-close" data-bs-dismiss="modal"></button>' : ''}
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        ${okCallback ? `<button type="button" class="btn btn-primary" id="${this.modalId}OkBtn">${okButtonText}</button>` : ''}
                    </div>
                </div>
            </div>
        `;

        setModalContent(this.modalId, title, content, this.options.size);

        if (okCallback) {
            showModal(this.modalId, `${this.modalId}OkBtn`, okCallback);
        } else {
            showModal(this.modalId);
        }
    }

    hide() {
        const modalElement = document.getElementById(this.modalId);
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }
        }
    }
}

// Modern Card Component
class ModernCard {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            title: '',
            icon: '',
            status: 'default', // default, success, warning, danger
            actions: [],
            ...options
        };
    }

    render() {
        const statusClasses = {
            default: '',
            success: 'border-success',
            warning: 'border-warning',
            danger: 'border-danger'
        };

        const statusIcons = {
            default: 'fa-circle',
            success: 'fa-check-circle',
            warning: 'fa-exclamation-circle',
            danger: 'fa-times-circle'
        };

        const statusColors = {
            default: 'text-muted',
            success: 'text-success',
            warning: 'text-warning',
            danger: 'text-danger'
        };

        let cardHTML = `
            <div class="card modern-card ${statusClasses[this.options.status]} h-100">
                <div class="card-header d-flex align-items-center">
                    <div class="bg-light rounded-circle p-2 me-3">
                        <i class="fas ${this.options.icon} fa-lg text-secondary"></i>
                    </div>
                    <div class="flex-grow-1">
                        <h6 class="card-title mb-1">${this.options.title}</h6>
                        <small class="status-badge ${statusColors[this.options.status]}">
                            <i class="fas ${statusIcons[this.options.status]} me-1"></i>
                            <span class="status-text">${this.options.status}</span>
                        </small>
                    </div>
                </div>
                <div class="card-body">
                    <div class="card-content">
                        ${this.options.content || ''}
                    </div>
                </div>
        `;

        if (this.options.actions.length > 0) {
            cardHTML += '<div class="card-footer">';
            this.options.actions.forEach(action => {
                cardHTML += `<button class="btn btn-sm ${action.class || 'btn-primary'}" onclick="${action.onclick}">${action.label}</button>`;
            });
            cardHTML += '</div>';
        }

        cardHTML += '</div>';

        this.container.innerHTML = cardHTML;
    }

    updateStatus(status) {
        this.options.status = status;
        const card = this.container.querySelector('.modern-card');
        const statusText = this.container.querySelector('.status-text');
        const statusIcon = this.container.querySelector('.status-badge i');

        // Remove all status classes
        card.classList.remove('border-success', 'border-warning', 'border-danger');
        statusText.classList.remove('text-muted', 'text-success', 'text-warning', 'text-danger');

        // Add new status classes
        const statusClasses = {
            default: '',
            success: 'border-success',
            warning: 'border-warning',
            danger: 'border-danger'
        };

        const statusIcons = {
            default: 'fa-circle',
            success: 'fa-check-circle',
            warning: 'fa-exclamation-circle',
            danger: 'fa-times-circle'
        };

        const statusColors = {
            default: 'text-muted',
            success: 'text-success',
            warning: 'text-warning',
            danger: 'text-danger'
        };

        card.classList.add(statusClasses[status]);
        statusText.classList.add(statusColors[status]);
        statusIcon.className = `fas ${statusIcons[status]} me-1`;
        statusText.textContent = status;
    }
}

// Icon Upload Component
// Reusable for any icon-upload card by passing callbacks/options:
// - `onUpload`, `onUrlInput`, `onRemove` for feature-specific behavior
// - `normalizePreviewUrl` for domain/path normalization
// - `iconKey`, `label`, `currentValue` for per-instance identity and content
// The component owns input/file/preview UI; persistence and status updates stay in page logic.
class IconUploadComponent {
    constructor(iconKey, container, options = {}) {
        this.iconKey = iconKey;
        this.container = container;
        this.options = {
            label: iconKey,
            currentValue: '',
            onUpload: null,
            onRemove: null,
            onUrlInput: null,
            normalizePreviewUrl: null,
            ...options
        };
    }

    getPreviewSrc(value) {
        if ((typeof value !== 'string') || (value.length === 0)) { return ''; }
        if (typeof this.options.normalizePreviewUrl !== 'function') { return value; }
        try { return this.options.normalizePreviewUrl(value); } catch (ex) { return value; }
    }

    render() {
        const hasIcon = this.options.currentValue.length > 0;
        const initialPreviewSrc = hasIcon ? this.getPreviewSrc(this.options.currentValue) : '';

        const html = `
            <div class="icon-upload-component" data-icon-key="${this.iconKey}">
                <div class="input-group mb-3">
                    <input type="text" class="form-control" id="iconInput_${this.iconKey}"
                           value="${this.options.currentValue}"
                           placeholder="Enter URL or data URL for ${this.options.label} icon"
                           oninput="window.iconUploadComponents['${this.iconKey}'].handleUrlInput(this)" />
                    <button class="btn btn-outline-primary" type="button" onclick="window.iconUploadComponents['${this.iconKey}'].triggerFileUpload()">
                        <i class="fas fa-upload me-2"></i>Upload
                    </button>
                </div>

                <div class="icon-preview-container ${hasIcon ? '' : 'd-none'}" id="preview_container_${this.iconKey}">
                    <small class="text-muted me-2">Preview:</small>
                    <img class="icon-preview-item" id="preview_${this.iconKey}"
                         src="${initialPreviewSrc}" alt="Icon preview" />
                    <button class="btn btn-sm btn-outline-danger ms-auto" type="button"
                            onclick="window.iconUploadComponents['${this.iconKey}'].removeIcon()">
                        <i class="fas fa-times me-1"></i>Default icon
                    </button>
                </div>

                <input type="file" class="d-none" accept=".svg,.png,image/svg+xml,image/png"
                       id="iconFile_${this.iconKey}"
                       onchange="window.iconUploadComponents['${this.iconKey}'].handleFileUpload(this)" />
            </div>
        `;

        this.container.innerHTML = html;

        // Store reference for global access
        if (!window.iconUploadComponents) {
            window.iconUploadComponents = {};
        }
        window.iconUploadComponents[this.iconKey] = this;
    }

    triggerFileUpload() {
        const fileInput = document.getElementById(`iconFile_${this.iconKey}`);
        if (fileInput) {
            fileInput.click();
        }
    }

    handleUrlInput(input) {
        const value = input.value.trim();
        const previewContainer = document.getElementById(`preview_container_${this.iconKey}`);
        const previewIcon = document.getElementById(`preview_${this.iconKey}`);

        if (value.length > 0) {
            previewContainer.classList.remove('d-none');
            if (previewIcon.tagName.toLowerCase() === 'img') { previewIcon.src = this.getPreviewSrc(value); }
            else { previewIcon.style.backgroundImage = `url('${value}')`; }
        } else {
            previewContainer.classList.add('d-none');
            if (previewIcon.tagName.toLowerCase() === 'img') { previewIcon.removeAttribute('src'); }
            else { previewIcon.style.backgroundImage = ''; }
        }

        if (this.options.onUrlInput) {
            this.options.onUrlInput(this.iconKey, value);
        }
    }

    async handleFileUpload(input) {
        if (!input || !input.files || (input.files.length === 0)) {
            return;
        }

        const button = this.container.querySelector('.btn-outline-primary');
        const originalContent = button.innerHTML;

        // Show loading state
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Uploading...';
        button.disabled = true;

        try {
            if (this.options.onUpload) {
                const result = await this.options.onUpload(this.iconKey, input.files[0]);

                // Show success state
                button.innerHTML = '<i class="fas fa-check me-2"></i>Success!';
                button.classList.remove('btn-outline-primary');
                button.classList.add('btn-success');

                // Update preview
                const previewContainer = document.getElementById(`preview_container_${this.iconKey}`);
                const previewIcon = document.getElementById(`preview_${this.iconKey}`);
                const textInput = document.getElementById(`iconInput_${this.iconKey}`);

                if (result && result.path) {
                    previewContainer.classList.remove('d-none');
                    if (previewIcon.tagName.toLowerCase() === 'img') { previewIcon.src = this.getPreviewSrc(result.path); }
                    else { previewIcon.style.backgroundImage = `url('${result.path}')`; }
                    textInput.value = result.path;
                }

                setTimeout(() => {
                    button.innerHTML = originalContent;
                    button.classList.remove('btn-success');
                    button.classList.add('btn-outline-primary');
                    button.disabled = false;
                }, 2000);
            }
        } catch (error) {
            // Show error state
            button.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i>Failed';
            button.classList.remove('btn-outline-primary');
            button.classList.add('btn-danger');

            setTimeout(() => {
                button.innerHTML = originalContent;
                button.classList.remove('btn-danger');
                button.classList.add('btn-outline-primary');
                button.disabled = false;
            }, 2000);
        }

        input.value = '';
    }

    removeIcon() {
        const previewContainer = document.getElementById(`preview_container_${this.iconKey}`);
        const previewIcon = document.getElementById(`preview_${this.iconKey}`);
        const textInput = document.getElementById(`iconInput_${this.iconKey}`);

        previewContainer.classList.add('d-none');
        if (previewIcon.tagName.toLowerCase() === 'img') { previewIcon.removeAttribute('src'); }
        else { previewIcon.style.backgroundImage = ''; }
        textInput.value = '';
        if (this.options.onUrlInput) {
            this.options.onUrlInput(this.iconKey, '');
        }

        if (this.options.onRemove) {
            this.options.onRemove(this.iconKey);
        }
    }
}

// Utility functions
function createModernModal(modalId, options = {}) {
    return new ModernModal(modalId, options);
}

function createModernCard(container, options = {}) {
    const card = new ModernCard(container, options);
    card.render();
    return card;
}

function openModal(options = {}) {
    const {
        modalId = 'xxAddAgent',
        title = '',
        body = '',
        size = null,
        okButtonId = 'idx_dlgOkButton',
        onOk = null,
        b = null,
        tag = null
    } = options;

    setModalContent(modalId, title, body, size);
    showModal(`${modalId}Modal`, okButtonId, onOk, b, tag);
}

function createIconUploadComponent(iconKey, container, options = {}) {
    const component = new IconUploadComponent(iconKey, container, options);
    component.render();
    return component;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ModernModal,
        ModernCard,
        IconUploadComponent,
        createModernModal,
        createModernCard,
        createIconUploadComponent
    };
}
