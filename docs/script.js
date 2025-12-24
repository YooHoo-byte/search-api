// Documentation Website Scripts

document.addEventListener('DOMContentLoaded', function() {
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();

            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'smooth'
                });

                // Update active nav link
                updateActiveNavLink(targetId);
            }
        });
    });

    // Update active nav link based on scroll position
    function updateActiveNavLink(targetId) {
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === targetId) {
                link.classList.add('active');
            }
        });
    }

    // Auto-update copyright year
    const yearElement = document.querySelector('.footer-bottom p:first-child');
    if (yearElement) {
        const currentYear = new Date().getFullYear();
        yearElement.innerHTML = yearElement.innerHTML.replace('2025', currentYear);
    }

    // Mobile menu toggle
    const mobileMenuToggle = document.createElement('button');
    mobileMenuToggle.className = 'mobile-menu-toggle';
    mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
    mobileMenuToggle.setAttribute('aria-label', 'Toggle menu');

    const header = document.querySelector('.header');
    if (window.innerWidth <= 768) {
        header.appendChild(mobileMenuToggle);

        mobileMenuToggle.addEventListener('click', function() {
            const sidebar = document.querySelector('.sidebar');
            sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
        });
    }

    // Add copy to clipboard functionality for code blocks
    document.querySelectorAll('pre code').forEach(codeBlock => {
        const pre = codeBlock.parentElement;
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-btn';
        copyButton.innerHTML = '<i class="far fa-copy"></i>';
        copyButton.setAttribute('aria-label', 'Copy code');
        copyButton.setAttribute('title', 'Copy to clipboard');

        copyButton.addEventListener('click', function() {
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(() => {
                copyButton.innerHTML = '<i class="fas fa-check"></i>';
                copyButton.style.color = '#27ae60';

                setTimeout(() => {
                    copyButton.innerHTML = '<i class="far fa-copy"></i>';
                    copyButton.style.color = '';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy code: ', err);
                copyButton.innerHTML = '<i class="fas fa-times"></i>';
                copyButton.style.color = '#e74c3c';

                setTimeout(() => {
                    copyButton.innerHTML = '<i class="far fa-copy"></i>';
                    copyButton.style.color = '';
                }, 2000);
            });
        });

        pre.style.position = 'relative';
        pre.appendChild(copyButton);
    });

    // Add syntax highlighting classes to inline code
    document.querySelectorAll('code:not(pre code)').forEach(inlineCode => {
        inlineCode.className = 'language-plaintext';
    });

    // Table of contents generator for long pages
    function generateTableOfContents() {
        const mainContent = document.querySelector('.content');
        if (!mainContent) return;

        const headings = mainContent.querySelectorAll('h2, h3');
        if (headings.length < 3) return;

        const tocContainer = document.createElement('div');
        tocContainer.className = 'table-of-contents';

        const tocTitle = document.createElement('h3');
        tocTitle.textContent = 'Table of Contents';
        tocTitle.style.marginBottom = '1rem';
        tocTitle.style.color = 'var(--secondary-color)';

        const tocList = document.createElement('ul');
        tocList.style.listStyle = 'none';
        tocList.style.padding = '0';

        headings.forEach((heading, index) => {
            if (!heading.id) {
                heading.id = 'section-' + index;
            }

            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = '#' + heading.id;
            link.textContent = heading.textContent;
            link.style.display = 'block';
            link.style.padding = '0.3rem 0';
            link.style.color = 'var(--text-secondary)';
            link.style.textDecoration = 'none';
            link.style.transition = 'var(--transition)';
            link.style.borderLeft = '3px solid transparent';
            link.style.paddingLeft = '0.5rem';

            link.addEventListener('mouseover', () => {
                link.style.color = 'var(--primary-color)';
                link.style.borderLeftColor = 'var(--primary-color)';
            });

            link.addEventListener('mouseout', () => {
                link.style.color = 'var(--text-secondary)';
                link.style.borderLeftColor = 'transparent';
            });

            if (heading.tagName === 'H3') {
                link.style.paddingLeft = '1.5rem';
                link.style.fontSize = '0.9rem';
            }

            listItem.appendChild(link);
            tocList.appendChild(listItem);
        });

        tocContainer.appendChild(tocTitle);
        tocContainer.appendChild(tocList);

        // Insert after first section or at the beginning
        const firstSection = mainContent.querySelector('.section');
        if (firstSection) {
            mainContent.insertBefore(tocContainer, firstSection);

            // Style the TOC container
            tocContainer.style.background = 'var(--card-bg)';
            tocContainer.style.padding = '1.5rem';
            tocContainer.style.borderRadius = 'var(--radius)';
            tocContainer.style.marginBottom = '2rem';
            tocContainer.style.border = '1px solid var(--border-color)';
            tocContainer.style.boxShadow = 'var(--shadow)';
        }
    }

    // Only generate TOC on long pages
    if (document.querySelectorAll('.section').length > 3) {
        generateTableOfContents();
    }

    // Add search functionality for API reference
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search documentation...';
    searchInput.className = 'search-input';
    searchInput.style.cssText = `
        width: 100%;
        padding: 0.8rem;
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        margin-bottom: 2rem;
        font-size: 1rem;
        transition: var(--transition);
    `;

    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();

        // Only search on pages with lots of content
        const sections = document.querySelectorAll('.section');
        sections.forEach(section => {
            const text = section.textContent.toLowerCase();
            if (text.includes(searchTerm) || searchTerm.length < 2) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        });
    });

    // Add search to pages with API reference
    if (window.location.pathname.includes('api-reference')) {
        const content = document.querySelector('.content');
        if (content) {
            content.insertBefore(searchInput, content.firstChild);
        }
    }

    // Add styling for copy buttons
    const style = document.createElement('style');
    style.textContent = `
        .copy-btn {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 0.3rem 0.6rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: var(--transition);
            backdrop-filter: blur(10px);
        }
        
        .copy-btn:hover {
            background: rgba(255,255,255,0.2);
            transform: scale(1.05);
        }
        
        .mobile-menu-toggle {
            display: none;
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: transparent;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            z-index: 1000;
        }
        
        @media (max-width: 768px) {
            .mobile-menu-toggle {
                display: block;
            }
            
            .sidebar {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 250px;
                height: 100vh;
                z-index: 999;
                box-shadow: 2px 0 10px rgba(0,0,0,0.1);
            }
        }
        
        .search-input:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        /* Print styles for copy buttons */
        @media print {
            .copy-btn {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);

    // Highlight current page in navigation
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach(link => {
        const linkHref = link.getAttribute('href');
        if (linkHref === currentPage || (currentPage === 'index.html' && linkHref === '#overview')) {
            link.classList.add('active');
        }
    });

    // Lazy loading for images
    document.querySelectorAll('img[data-src]').forEach(img => {
        img.src = img.getAttribute('data-src');
        img.removeAttribute('data-src');
    });
});