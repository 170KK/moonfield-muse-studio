import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const COL_GAP = 80;
const ROW_GAP = 64;

export function autoArrangeCanvasNodes(
    allNodes: CanvasNodeData[],
    connections: CanvasConnection[],
    selectedIds?: Set<string>,
): CanvasNodeData[] {
    const useSelection = Boolean(selectedIds && selectedIds.size >= 2);
    const targetNodes = allNodes.filter(
        (n) => n.type !== CanvasNodeType.Group && (!useSelection || selectedIds!.has(n.id)),
    );
    if (targetNodes.length <= 1) return allNodes;

    const targetIdSet = new Set(targetNodes.map((n) => n.id));
    const activeConns = connections.filter(
        (c) => targetIdSet.has(c.fromNodeId) && targetIdSet.has(c.toNodeId) && c.fromNodeId !== c.toNodeId,
    );

    const nodeById = new Map(targetNodes.map((n) => [n.id, n]));
    const outMap = new Map<string, string[]>();
    const inMap = new Map<string, string[]>();
    for (const n of targetNodes) {
        outMap.set(n.id, []);
        inMap.set(n.id, []);
    }
    for (const c of activeConns) {
        outMap.get(c.fromNodeId)?.push(c.toNodeId);
        inMap.get(c.toNodeId)?.push(c.fromNodeId);
    }

    // 1. Longest-path DAG layering
    // - Video -> Video continuity stays in the same vertical column (step = 0)
    // - Image -> Video reserves an extra column for video prompt text nodes when the video has a text input (step = 2)
    const layer = new Map<string, number>();
    for (const n of targetNodes) layer.set(n.id, 0);

    const maxPasses = Math.min(targetNodes.length, 30);
    for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;
        for (const c of activeConns) {
            const fromNode = nodeById.get(c.fromNodeId);
            const toNode = nodeById.get(c.toNodeId);
            let step = 1;
            if (fromNode?.type === CanvasNodeType.Video && toNode?.type === CanvasNodeType.Video) {
                step = 0;
            } else if (fromNode?.type === CanvasNodeType.Image && toNode?.type === CanvasNodeType.Video) {
                const videoInputs = inMap.get(toNode.id) || [];
                const hasTextPromptInput = videoInputs.some((id) => nodeById.get(id)?.type === CanvasNodeType.Text);
                if (hasTextPromptInput) step = 2;
            }
            const uLayer = layer.get(c.fromNodeId) || 0;
            const vLayer = layer.get(c.toNodeId) || 0;
            if (vLayer < uLayer + step) {
                layer.set(c.toNodeId, uLayer + step);
                changed = true;
            }
        }
        if (!changed) break;
    }

    for (const n of targetNodes) {
        const ins = inMap.get(n.id) || [];
        const outs = outMap.get(n.id) || [];
        if (ins.length === 0 && outs.length > 0) {
            const minOutLayer = Math.min(...outs.map((id) => layer.get(id) || 0));
            if (minOutLayer > 1) {
                layer.set(n.id, minOutLayer - 1);
            }
        }
    }

    const connectedNodes: CanvasNodeData[] = [];
    const isolatedNodes: CanvasNodeData[] = [];
    for (const n of targetNodes) {
        const deg = (inMap.get(n.id)?.length || 0) + (outMap.get(n.id)?.length || 0);
        if (deg > 0) connectedNodes.push(n);
        else isolatedNodes.push(n);
    }

    const minX = Math.min(...targetNodes.map((n) => n.position.x));
    const minY = Math.min(...targetNodes.map((n) => n.position.y));
    const nextPositions = new Map<string, { x: number; y: number }>();

    // 2. Column-vertical layout: each stage/layer is one clean vertical column from top to bottom
    const colGroups = new Map<number, CanvasNodeData[]>();
    for (const n of connectedNodes) {
        const col = layer.get(n.id) || 0;
        const list = colGroups.get(col) || [];
        list.push(n);
        colGroups.set(col, list);
    }

    const sortedCols = Array.from(colGroups.keys()).sort((a, b) => a - b);
    let cursorX = minX;
    let maxConnectedBottom = minY;

    for (const col of sortedCols) {
        const colNodes = colGroups.get(col)!;
        colNodes.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

        let cursorY = minY;
        let colMaxW = 0;
        for (const node of colNodes) {
            nextPositions.set(node.id, { x: Math.round(cursorX), y: Math.round(cursorY) });
            cursorY += node.height + ROW_GAP;
            colMaxW = Math.max(colMaxW, node.width);
        }
        maxConnectedBottom = Math.max(maxConnectedBottom, cursorY);
        cursorX += colMaxW + COL_GAP;
    }

    // 3. Isolated nodes arranged horizontally in rows of 5
    if (isolatedNodes.length > 0) {
        isolatedNodes.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
        const colsPerRow = 5;
        let rowY = connectedNodes.length > 0 ? maxConnectedBottom + ROW_GAP * 2 : minY;
        for (let i = 0; i < isolatedNodes.length; i += colsPerRow) {
            const rowSlice = isolatedNodes.slice(i, i + colsPerRow);
            let rowX = minX;
            let rowMaxH = 0;
            for (const node of rowSlice) {
                nextPositions.set(node.id, { x: Math.round(rowX), y: Math.round(rowY) });
                rowX += node.width + COL_GAP;
                rowMaxH = Math.max(rowMaxH, node.height);
            }
            rowY += rowMaxH + ROW_GAP;
        }
    }

    return allNodes.map((n) => {
        const pos = nextPositions.get(n.id);
        return pos ? { ...n, position: pos } : n;
    });
}
