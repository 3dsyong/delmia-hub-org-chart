// --- Configuration ---
const NODE_WIDTH = 225; 
const NODE_HEIGHT = 50; 
// Depth spacing: horizontal space between node centers (Root -> Child)
const HORIZONTAL_NODE_GAP = 100; 
// Breadth spacing: vertical space between sibling node centers
const VERTICAL_NODE_GAP = 10; // Reduced from 40 to 10 to decrease vertical separation
const DATA_FILE_PATH = "orgdata.json"; // Path to the JSON file

// Global variable for transition duration (FIX: Moved here to resolve ReferenceError)
const DURATION = 500; 

const countryAbbr = {
    "Australia": "AU",
    "Brazil": "BR",
    "Emirates": "AE",   // UAE / Emirates
    "France": "FR",
    "Germany": "DE",
    "India": "IN",
    "Italy": "IT",
    "Malaysia": "MY",
    "Netherlands": "NL",
    "Poland": "PL",
    "Spain": "ES",
    "USA": "US"
};

// ---------------------------------------------------------
// 1. DATA LOADING FUNCTION - Uses d3.json to fetch data
// ---------------------------------------------------------
d3.json(DATA_FILE_PATH).then(orgData => {
    // Hide loading message once data fetching starts (or succeeds)
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }

    if (orgData && orgData.length > 0) {
		// --- LAST UPDATE HANDLING ---
        // Expect the first object in array to contain the 'lastUpdate' field
        const lastUpdate = orgData[0].lastUpdate || "Unknown";
        const lastUpdateDiv = document.getElementById("lastUpdate");
        if (lastUpdateDiv) {
            lastUpdateDiv.textContent = "Last Update: " + lastUpdate;
        }

        // If data loads successfully, initialize the chart
        initializeChart(orgData);
    } else {
        d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Data is empty or invalid in orgdata.json.</p>");
    }
}).catch(error => {
    // Hide loading message and show error if fetch fails
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }
    // Detailed error logging to help debug the fetch issue on your server
    console.error(`Failed to load JSON file at path: ${DATA_FILE_PATH}`, error);
    d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Failed to fetch or parse data. Check console (F12) for network and JSON parsing errors.</p>");
});


function initializeChart(orgData) {
    // --- Setup ---

    // Create the main SVG container with an initial size
    const svg = d3.select("#chart-container").append("svg")
        .attr("width", 1000)
        .attr("height", 800);

    // Group element for transformation (moving the whole chart)
    const g = svg.append("g");

    // Define tree layout with nodeSize 
    const tree = d3.tree()
        // D3's nodeSize expects [breadth, depth]. 
        // For L-to-R: breadth (x) is vertical spacing, depth (y) is horizontal spacing.
        .nodeSize([NODE_HEIGHT + VERTICAL_NODE_GAP, NODE_WIDTH + HORIZONTAL_NODE_GAP]); 

    const stratify = d3.stratify()
        .id(d => d.id)
        .parentId(d => d.parentid);

    // Tooltip element (must be appended to the body for correct positioning)
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip");

    // --- Core Functions for Hierarchy Calculation ---

    // Recursively calculates the number of direct reports (X) and total descendants (Y) for a node.
    function calculateReports(node) {
        // Initialize counts
        node.directReports = 0;
        node.totalDescendants = 0;
        
        // Collect all actual children (whether expanded or collapsed)
        const allChildren = (node.children || []).concat(node._children || []);
        
        if (allChildren.length > 0) {
            // X: Number of direct reports (immediate children)
            node.directReports = allChildren.length;
            
            let totalDescendants = 0;
            
            allChildren.forEach(child => {
                // Recurse down
                calculateReports(child);
                
                // Accumulate total reports: (child itself + its total descendants)
                totalDescendants += (child.totalDescendants + 1); 
            });
            
            // Y: Total number of nodes under this node
            node.totalDescendants = totalDescendants;
        } 
        // If no children, both counts remain 0.
    }

    // --- Initialization ---

    // 1. Clean Data: Filter out records without an ID or an undefined parentid
    const cleanData = orgData.filter(d => d.id && d.parentid !== undefined);

    // 2. Build Hierarchy
    let root;
	let currentlyHighlightedNode = null;

    try {
        root = stratify(cleanData)
            .sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
    } catch (e) {
        console.error("Error creating hierarchy: Stratify failed.", e);
        // This specific error means stratify couldn't find a single node with a null/empty parentid to be the root.
        d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Could not establish chart hierarchy. Ensure exactly one employee has an empty parentid: \"\" for the root.</p>");
        return; // Stop initialization if root fails
    }

    if (root) {
        // Calculate report counts for the full hierarchy
        calculateReports(root);
        
        // Initial position
        root.x0 = 0;
        root.y0 = 0;

        // Initial Collapse (only level 2 and below)
        if (root.children) {
             root.children.forEach(child => {
                if (child.children) { 
                    collapse(child);
                }
            });
        }
        
        update(root);
    }

    // --- Helper Functions for Collapse/Expand All ---

    // Recursively expands all nodes beneath the current node.
    function expandAll(d) {
        if (d._children) {
            d.children = d._children;
            d._children = null;
        }
        if (d.children) {
            d.children.forEach(expandAll);
        }
    }

    // Recursively collapses all nodes beneath the current node.
    function collapseAll(d) {
        if (d.children) {
            d._children = d.children;
            d.children = null;
            d._children.forEach(collapseAll);
        }
    }

    // Function to collapse the entire tree to only show the root and its direct children (Layer 2)
    function collapseToLayer2() {
        // Ensure the root itself is expanded first (in case it was collapsed manually)
        if (root._children) {
             root.children = root._children;
             root._children = null;
        }
        // Then, collapse all children of the direct reports (layer 2 nodes)
        if (root.children) {
            root.children.forEach(collapseAll);
        }
        update(root);
    }
	
	// Reset highlight on all nodes
	function clearHighlight() {
		currentlyHighlightedNode = null;
		d3.selectAll("g.node rect")
			.style("stroke", "#005386") 
			.style("stroke-width", d => (d.children && d.children.length > 0) ? 3 : 1)
			.style("fill", d => (d.children && d.children.length > 0) ? "#e6f7ff" : "#fff");
	}


	// Highlight one node
	function highlightNode(node) {
		clearHighlight();
		currentlyHighlightedNode = node;

		d3.selectAll("g.node")
			.filter(d => d === node)
			.select("rect")
			.style("stroke", "orange")
			.style("stroke-width", d => (d.children && d.children.length > 0) ? 4 : 2) // thicker only if expanded
			.style("fill", d => (d.children && d.children.length > 0) ? "#e6f7ff" : "#fff"); // light blue if expanded
	}


    // Expand All button
	const expandAllBtn = document.getElementById("expand-all-button");
	if (expandAllBtn) {
		expandAllBtn.addEventListener("click", () => {
			clearHighlight();            // remove search highlight
			expandAll(root);             // existing function you already have
			update(root);                // redraw fully expanded
		});
	}

	// Collapse All button (collapse to level 2)
	const collapseAllBtn = document.getElementById("collapse-all-button");
	if (collapseAllBtn) {
		collapseAllBtn.addEventListener("click", () => {
			clearHighlight();            // remove search highlight
			collapseToLayer2();          // existing function you already have
			update(root);                // redraw collapsed chart
		});
	}
	
	// -----------------------------
	// SEARCH: find (name or id), expand path, center view
	// -----------------------------

	// Robust DFS search that visits both children and _children
	function findNodeByText(rootNode, text) {
		const q = text.toLowerCase();
		let found = null;

		function dfs(node) {
			if (!node || found) return;
			const name = (node.data.name || "").toLowerCase();
			const id = (node.data.id || "").toLowerCase();
			if ((name && name.includes(q)) || (id && id.includes(q))) {
				found = node;
				return;
			}
			const kids = (node.children || []).concat(node._children || []);
			for (let c of kids) {
				dfs(c);
				if (found) return;
			}
		}

		dfs(rootNode);
		return found;
	}

	// Expand all ancestors (from root down to the parent of the node)
	function expandAncestors(node) {
		let cur = node;
		// climb up and expand each parent (stop when parent is null)
		while (cur && cur.parent) {
			const p = cur.parent;
			if (p._children) {
				p.children = p._children;
				p._children = null;
			}
			cur = p;
		}
	}
	
	// Collapse entire subtree (children → _children), recursively
	function collapseSubtree(node) {
		if (node.children) {
			node._children = node.children;
			node.children = null;
			node._children.forEach(collapseSubtree);
		}
	}
	
	// Collapse everything EXCEPT the ancestor chain leading to the found node
	function collapseAllExceptPathTo(targetNode) {
		// 1. Build a set of all ancestors (root → target)
		const keep = new Set();
		let cur = targetNode;
		while (cur) {
			keep.add(cur);
			cur = cur.parent;
		}

		// 2. Walk entire tree and collapse any node not in the ancestor chain
		function walk(node) {
			if (!node) return;

			const isPathNode = keep.has(node);

			if (!isPathNode) {
				// collapse entire subtree if this branch is not on the path
				collapseSubtree(node);
			}

			const kids = (node.children || []).concat(node._children || []);
			kids.forEach(walk);
		}

		walk(root);
	}


	// Center the chart container on the given node (recomputes layout as update() does)
	function centerOnNode(node) {
		if (!node) return;

		// recompute tree positions (same as in update)
		const treeData = tree(root);
		const nodesArr = treeData.descendants();

		let minBreadth = Infinity, maxBreadth = -Infinity, maxDepth = -Infinity;
		nodesArr.forEach(d => {
			if (d.x < minBreadth) minBreadth = d.x;
			if (d.x > maxBreadth) maxBreadth = d.x;
			if (d.y > maxDepth) maxDepth = d.y;
		});

		const verticalShift = Math.abs(minBreadth) + 50;
		const horizontalOffset = (NODE_WIDTH / 2) + 20;

		// pixel coordinates inside the full SVG (taking group transform into account)
		const pixelX = verticalShift + node.x; 
		const pixelY = horizontalOffset + node.y;

		const container = document.getElementById("chart-container");
		if (!container) return;

		const targetScrollTop = Math.max(0, pixelX - (container.clientHeight / 2));
		const targetScrollLeft = Math.max(0, pixelY - (container.clientWidth / 2));

		container.scrollTo({
			top: targetScrollTop,
			left: targetScrollLeft,
			behavior: "smooth"
		});
	}

	// Search UI wiring
	const searchButton = document.getElementById("search-button");
	const searchInput = document.getElementById("search-input");
	const searchMessage = document.getElementById("search-message");

	// Function that performs the search action
	function performSearch() {
		if (!searchInput) return;
		const q = searchInput.value.trim();
		if (!q) {
			// clear message if empty
			if (searchMessage) searchMessage.textContent = "";
			return;
		}

		// search the entire hierarchy including collapsed nodes
		const found = findNodeByText(root, q);

		if (!found) {
			// show inline not found message briefly
			if (searchMessage) {
				searchMessage.textContent = "No matching name or trigram found.";
				// clear message after 3 seconds
				setTimeout(() => { if (searchMessage) searchMessage.textContent = ""; }, 3000);
			} else {
				alert("No matching name or trigram found.");
			}
			return;
		}

		// 1. Collapse everything except the path
		collapseAllExceptPathTo(found);

		// 2. Expand all ancestors of the found node
		expandAncestors(found);

		// 3. Re-render
		update(root);

		// 4. Highlight found node
		setTimeout(() => {
			highlightNode(found);
		}, 30);

		// 5. Center view
		setTimeout(() => {
			centerOnNode(found);
		}, 60);

		// clear any message
		if (searchMessage) searchMessage.textContent = "";
	}

	// wire button click and Enter key
	if (searchButton) {
		searchButton.addEventListener("click", performSearch);
	}
	if (searchInput) {
		searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") performSearch();
		});
	}

    
    // --- Core Functions ---

    function collapse(d) {
        if (d.children) {
            d._children = d.children;
            d._children.forEach(collapse);
            d.children = null;
        }
    }


    function update(source) {
        // 1. Compute the new tree layout
        const treeData = tree(root);
        const nodes = treeData.descendants();
        const links = treeData.descendants().slice(1);

        // 2. DYNAMIC RESIZING LOGIC
        // d.x = breadth (Vertical position), d.y = depth (Horizontal position)
        let minBreadth = Infinity; 
        let maxBreadth = -Infinity; 
        let maxDepth = -Infinity;   

        nodes.forEach(d => {
            if (d.x < minBreadth) minBreadth = d.x; 
            if (d.x > maxBreadth) maxBreadth = d.x; 
            if (d.y > maxDepth) maxDepth = d.y; 
        });

        // Calculate needed SVG dimensions
        const chartTotalHeight = (maxBreadth - minBreadth) + NODE_HEIGHT; 
        const chartTotalWidth = maxDepth + NODE_WIDTH; 
        
        const svgWidth = chartTotalWidth + 100; // Add margin 
        const svgHeight = chartTotalHeight + 100; // Add margin
        
        // Resize SVG container element
        svg.transition().duration(DURATION)
            .attr("width", svgWidth)
            .attr("height", svgHeight);

        // 3. CHART ALIGNMENT (LEFT-TO-RIGHT)
        // Vertical shift to center the visible chart
        const verticalShift = Math.abs(minBreadth) + 50; 
        
        // Reverted offset: Half the node width plus a comfortable margin (20px)
        const horizontalOffset = (NODE_WIDTH / 2) + 20; // 110 pixels 

		const scale = 1; // 95% of original size
		
        // Shift the entire group element (g)
        g.transition().duration(DURATION)
            // Transform applies SVG coordinates (X, Y)
			.attr("transform", `translate(${horizontalOffset}, ${verticalShift}) scale(${scale})`);
	
        // --- Draw Nodes ---
        let i = 0;
        const node = g.selectAll('g.node')
            .data(nodes, d => d.id || (d.id = ++i));

        const nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            // Start transition from the source (parent's) old position (y0, x0)
            .attr("transform", d => `translate(${source.y0},${source.x0})`) 
            .on('click', click)
            .on('mouseover', mouseover)
            .on('mouseout', mouseout);

        // Node Box (Rect)
        nodeEnter.append('rect')
            .attr('width', NODE_WIDTH)
            .attr('height', NODE_HEIGHT)
            .attr('x', -NODE_WIDTH / 2) // Center the node card
            .attr('y', -NODE_HEIGHT / 2)
            // Initial fill style
            .style("fill", d => (d.children && d.children.length > 0) ? "#e6f7ff" : "#fff")
			.style("stroke", "#005386")
			.style("stroke-width", d => (d.children && d.children.length > 0) ? 3 : 1);

        // Name and ID Text (Combined)
        const nameIdText = nodeEnter.append('text')
            .attr('class', 'node-name-id')
            .attr("text-anchor", "middle")
            .attr("dy", "-0.35em") 
            .style("font-weight", "bold")
            .style("font-size", "13px");
        
        // Name tspan
        nameIdText.append('tspan')
            .text(d => d.data.name);

        // Report Count Text [X, Y]
        nameIdText.append('tspan')
            .attr('dx', '5')
            .style("font-size", "10px") 
            .style("fill", "#555") 
            // Display [X: Direct Reports, Y: Total Descendants]
            .text(d => d.directReports > 0 ? `[${d.directReports}, ${d.totalDescendants}]` : '');

        // Title Text
        nodeEnter.append('text')
            .attr("class", "title")
            .attr("text-anchor", "middle")
            .attr("dy", "1.2em") 
            .style("font-size", "11px")
            .style("fill", "#333")
            .text(d => {
				const role = d.data.title || "";
				const countryFull = d.data.country || "";
				const country = countryAbbr[countryFull] || countryFull; // fallback if not in map
				return country ? `${role}, ${country}` : role;
			});
		
		// EXPAND/COLLAPSE INDICATOR
        nodeEnter.append('text')
            .attr('class', 'toggle-indicator')
            .attr('text-anchor', 'end')
            .attr('x', NODE_WIDTH / 2 - 5) 
            .attr('y', NODE_HEIGHT / 2 - 5) 
            .style('font-size', '18px')
            .style('font-weight', 'bold')
            .style('fill', '#005386') 
            .text(d => d.children || d._children ? (d.children ? "−" : "+") : "");

        // UPDATE
        const nodeUpdate = nodeEnter.merge(node);

        nodeUpdate.transition().duration(DURATION)
            // Move to final position (y, x)
            .attr("transform", d => `translate(${d.y},${d.x})`);

        // Update style
        nodeUpdate.select('rect')
			.style("fill", d => d.children && d.children.length > 0 ? "#e6f7ff" : "#fff") // light blue if expanded
			.style("stroke", "#005386") // always blue border
			.style("stroke-width", d => d.children && d.children.length > 0 ? 3 : 1); // thicker only if expanded
			
        // Update the indicator text
        nodeUpdate.select('.toggle-indicator')
            .text(d => d.children || d._children ? (d.children ? "−" : "+") : "");

        // EXIT
        node.exit().transition().duration(DURATION)
            // Transition back to the source's current position (y, x)
            .attr("transform", d => `translate(${source.y},${source.x})`)
            .remove();

        // --- Draw Links ---
        const link = g.selectAll('path.link')
            .data(links, d => d.id);

        const linkEnter = link.enter().insert('path', "g")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke-width", 1.5)
            // Start transition from the source (parent's) old position (y0, x0)
            .attr('d', d => {
                const o = {x: source.x0, y: source.y0};
                return diagonal(o, o);
            });

        const linkUpdate = linkEnter.merge(link);

        linkUpdate.transition().duration(DURATION)
            // Move to final position (y, x)
            .attr('d', d => diagonal(d, d.parent))
            // Ensure links are blue
            .style("stroke", "#005386"); 

        link.exit().transition().duration(DURATION)
            // Transition back to the source's current position (y, x)
            .attr('d', d => {
                const o = {x: source.x, y: source.y};
                return diagonal(o, o);
            })
            .remove();

        // Save current positions (y, x) as old positions (y0, x0)
        nodes.forEach(d => {
            d.x0 = d.x;
            d.y0 = d.y;
        });
    }

    function diagonal(s, d) {
        // Horizontal elbow connector for (Left-to-Right) layout
        // s: target node, d: source/parent node
        // Coordinates are swapped (y, x) for SVG rendering
        return `M ${d.y} ${d.x}
                C ${(d.y + s.y) / 2} ${d.x},
                  ${(d.y + s.y) / 2} ${s.x},
                  ${s.y} ${s.x}`;
    }

    // Toggle children
    function click(event, d) {
        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else {
            d.children = d._children;
            d._children = null;
        }
        update(d);
    }

    function mouseover(event, d) {
        const data = d.data;
        
        // Tooltip styling and content
        d3.select("body").select(".tooltip").transition().duration(200).style("opacity", .9);
        d3.select("body").select(".tooltip").html(`
            <div style="text-align: center; font-size: 1.1em; font-weight: bold; margin-bottom: 3px; color: white;">
                ${data.name} 
                <span style="font-size: 0.75em; font-weight: normal; color: rgba(255, 255, 255, 0.7);">(${data.id})</span>
            </div>
            <div style="text-align: center; margin-bottom: 5px; color: white;">${data.title}</div>
            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.3); margin: 5px 0;">
            
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em; color: white;">
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Team:</strong></td>
                    <td style="text-align: left;">${data.team || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Country:</strong></td>
                    <td style="text-align: left;">${data.country || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Email:</strong></td>
                    <td style="text-align: left;">${data.email || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>OU:</strong></td>
                    <td style="text-align: left;">${data.OU || 'N/A'}</td>
                </tr>
            </table>
        `)
        // Tooltip position
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 28) + "px");
    }

    function mouseout() {
        d3.select("body").select(".tooltip").transition().duration(DURATION).style("opacity", 0);
    }
}