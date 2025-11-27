// --- Configuration ---
const NODE_WIDTH = 180; 
const NODE_HEIGHT = 60; 
const VERTICAL_SPACING = 100; 
const HORIZONTAL_SPACING = 40; 
const ROOT_TOP_MARGIN = 50;   
const DATA_FILE_PATH = "orgdata.json"; // Path to the JSON file

// ---------------------------------------------------------
// 1. DATA LOADING FUNCTION - Uses d3.json to fetch data
// ---------------------------------------------------------
d3.json(DATA_FILE_PATH).then(orgData => {
    // Hide loading message once data fetching starts (or succeeds)
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }

    if (orgData) {
        // If data loads successfully, initialize the chart
        initializeChart(orgData);
    } else {
        d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Could not load data from orgdata.json.</p>");
    }
}).catch(error => {
    // Hide loading message and show error if fetch fails
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }
    console.error("Failed to load JSON file:", error);
    d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Failed to fetch data. Check if 'orgdata.json' exists in the same directory.</p>");
});


function initializeChart(orgData) {
    // --- Setup ---

    // Create the main SVG container with an initial size
    const svg = d3.select("#chart-container").append("svg")
        .attr("width", 1000)
        .attr("height", 800);

    // Group element for transformation (moving the whole chart)
    const g = svg.append("g")
        .attr("transform", `translate(0, ${ROOT_TOP_MARGIN})`);

    // Define tree layout with nodeSize 
    const tree = d3.tree()
        .nodeSize([NODE_WIDTH + HORIZONTAL_SPACING, NODE_HEIGHT + VERTICAL_SPACING]);

    const stratify = d3.stratify()
        .id(d => d.id)
        .parentId(d => d.parentid);

    // Color scale for branches
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    // Tooltip element
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip");

    // --- Initialization ---

    // 1. Clean Data
    const cleanData = orgData.filter(d => d.id && d.parentid !== undefined);

    // 2. Build Hierarchy
    let root;
    try {
        root = stratify(cleanData)
            .sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
    } catch (e) {
        console.error("Error creating hierarchy:", e);
        d3.select("#chart-container").html("<p style='color:red; padding:20px'>Error: Could not find root node. Ensure one employee has an empty parentid.</p>");
        return; // Stop initialization if root fails
    }

    if (root) {
        // Initial position
        root.x0 = 0;
        root.y0 = 0;

        // Collapse lower levels initially
        if (root.children) {
            root.children.forEach(collapse);
        }
        
        update(root);
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

        // 2. DYNAMIC RESIZING LOGIC (Adjusts SVG size to fit content)
        let minX = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        nodes.forEach(d => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y > maxY) maxY = d.y;
        });

        // Calculate new width/height with padding (200px buffer)
        const chartTotalWidth = (maxX - minX) + NODE_WIDTH; 
        const svgWidth = chartTotalWidth + 200; 
        const svgHeight = maxY + NODE_HEIGHT + 200; 
        
        // Resize SVG container element
        svg.transition().duration(500)
            .attr("width", svgWidth)
            .attr("height", svgHeight);

        // 3. CENTERING LOGIC
        const centerShift = Math.abs(minX) + (NODE_WIDTH / 2) + 80; 
        
        // Shift the entire group element
        g.transition().duration(500)
            .attr("transform", `translate(${centerShift}, ${ROOT_TOP_MARGIN})`);

        // --- Draw Nodes ---
        let i = 0;
        const node = g.selectAll('g.node')
            .data(nodes, d => d.id || (d.id = ++i));

        const nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            .attr("transform", d => `translate(${source.x0},${source.y0})`)
            .on('click', click)
            .on('mouseover', mouseover)
            .on('mouseout', mouseout);

        // Node Box (Rect) - Back to fixed size
        nodeEnter.append('rect')
            .attr('width', NODE_WIDTH)
            .attr('height', NODE_HEIGHT)
            .attr('x', -NODE_WIDTH / 2)
            .attr('y', -NODE_HEIGHT / 2)
            .style("fill", d => d._children ? "#e6f7ff" : "#fff");

        // Name and ID Text (Combined, no wrapping)
        const nameIdText = nodeEnter.append('text')
            .attr('class', 'node-name-id')
            .attr("text-anchor", "middle")
            .attr("dy", "-0.8em") // Fixed position for name/ID
            .style("font-weight", "bold")
            .style("font-size", "14px");
        
        // Name tspan
        nameIdText.append('tspan')
            .text(d => d.data.name);

        // ID tspan
        nameIdText.append('tspan')
            .attr('dx', '5')
            .style("font-size", "11px") // 11px size restored
            .style("fill", "#555") // #555 color restored
            .text(d => `(${d.data.id})`);


        // Title Text (Fixed position)
        nodeEnter.append('text')
            .attr("class", "title")
            .attr("text-anchor", "middle")
            .attr("dy", "1em") // Fixed position for title
            .style("font-size", "12px")
            .style("fill", "#333")
            .text(d => d.data.title);

        // EXPAND/COLLAPSE INDICATOR (Fixed position)
        nodeEnter.append('text')
            .attr('class', 'toggle-indicator')
            .attr('text-anchor', 'end')
            .attr('x', NODE_WIDTH / 2 - 5) 
            .attr('y', NODE_HEIGHT / 2 - 5) 
            .style('font-size', '20px')
            .style('font-weight', 'bold')
            .style('fill', '#005386') 
            .text(d => d.children || d._children ? (d.children ? "−" : "+") : "");

        // UPDATE
        const nodeUpdate = nodeEnter.merge(node);

        nodeUpdate.transition().duration(500)
            .attr("transform", d => `translate(${d.x},${d.y})`);

        // Update style (colors)
        nodeUpdate.select('rect')
            .style("fill", d => d._children ? "#e6f7ff" : "#fff")
            .style("stroke", d => {
                if (!d.parent) return "#005386";
                let ancestor = d;
                while (ancestor.depth > 1) ancestor = ancestor.parent;
                return colorScale(ancestor.id);
            })
            .style("stroke-width", d => d._children ? 3 : 1);
            
        // Update the indicator text based on collapsed/expanded state
        nodeUpdate.select('.toggle-indicator')
            .text(d => d.children || d._children ? (d.children ? "−" : "+") : "");

        // EXIT
        node.exit().transition().duration(500)
            .attr("transform", d => `translate(${source.x},${source.y})`)
            .remove();

        // --- Draw Links ---
        const link = g.selectAll('path.link')
            .data(links, d => d.id);

        const linkEnter = link.enter().insert('path', "g")
            .attr("class", "link")
            .attr('d', d => {
                const o = {x: source.x0, y: source.y0};
                return diagonal(o, o);
            });

        const linkUpdate = linkEnter.merge(link);

        linkUpdate.transition().duration(500)
            .attr('d', d => diagonal(d, d.parent))
            .style("stroke", d => {
                 let ancestor = d;
                 while (ancestor.depth > 1) ancestor = ancestor.parent;
                 return ancestor.parent ? colorScale(ancestor.id) : "#ccc";
            });

        link.exit().transition().duration(500)
            .attr('d', d => {
                const o = {x: source.x, y: source.y};
                return diagonal(o, o);
            })
            .remove();

        // Save old positions
        nodes.forEach(d => {
            d.x0 = d.x;
            d.y0 = d.y;
        });
    }

    function diagonal(s, d) {
        // Elbow connector (Vertical)
        return `M ${s.x} ${s.y}
                C ${s.x} ${(s.y + d.y) / 2},
                  ${d.x} ${(s.y + d.y) / 2},
                  ${d.x} ${d.y}`;
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

        const utzValue = data.utzTarget && data.utzTarget !== "" ? `${data.utzTarget}%` : "-";

        let rampUpRow = '';
        if (data.rampUpEndDate && data.rampUpEndDate !== "") {
            rampUpRow = `
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Ramp-up End:</strong></td>
                    <td style="text-align: left;">${data.rampUpEndDate}</td>
                </tr>`;
        }

        tooltip.transition().duration(200).style("opacity", .9);
        tooltip.html(`
            <div style="text-align: center; font-size: 1.1em; font-weight: bold; margin-bottom: 3px;">
                ${data.name} 
                <span style="font-size: 0.75em; font-weight: normal; color: white;">(${data.id})</span>
            </div>
            <div style="text-align: center; margin-bottom: 5px;">${data.title}</div>
            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.3); margin: 5px 0;">
            
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
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
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Consultant Type:</strong></td>
                    <td style="text-align: left;">${data.consultantType || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Billable:</strong></td>
                    <td style="text-align: left;">${data.billable}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>Indv. UTZ Target:</strong></td>
                    <td style="text-align: left;">${data.hasUTZTarget}</td>
                </tr>
                <tr>
                    <td style="text-align: left; padding-right: 10px; white-space: nowrap;"><strong>UTZ Target:</strong></td>
                    <td style="text-align: left;">${utzValue}</td>
                </tr>
                ${rampUpRow}
            </table>
        `)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 28) + "px");
    }

    function mouseout() {
        tooltip.transition().duration(500).style("opacity", 0);
    }
}