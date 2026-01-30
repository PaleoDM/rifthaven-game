import { GAME_CONFIG } from '../config';
import { Unit, TerrainType } from '../data/BattleTypes';

interface GridCell {
  x: number;
  y: number;
  terrain: TerrainType;
  unit: Unit | null;
}

interface PathNode {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic (Manhattan distance to goal)
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

/**
 * GridManager handles all grid-based operations for the battle system:
 * - Terrain queries
 * - Unit position tracking
 * - Pathfinding (A*)
 * - Movement range calculation
 * - Line of sight / range checks
 */
export class GridManager {
  private grid: GridCell[][];
  private width: number;
  private height: number;

  constructor(terrainData: number[][], width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid = [];

    // Initialize grid from terrain data
    for (let y = 0; y < height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < width; x++) {
        this.grid[y][x] = {
          x,
          y,
          terrain: (terrainData[y]?.[x] ?? 0) as TerrainType,
          unit: null,
        };
      }
    }
  }

  // ============================================
  // Basic Grid Queries
  // ============================================

  getCell(x: number, y: number): GridCell | null {
    if (!this.isValidPosition(x, y)) return null;
    return this.grid[y][x];
  }

  isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTerrain(x: number, y: number): TerrainType {
    const cell = this.getCell(x, y);
    return cell ? cell.terrain : TerrainType.Impassable;
  }

  isWalkable(x: number, y: number, flying?: boolean): boolean {
    // Flying units can move over any terrain (except off-map)
    if (flying) return this.isValidPosition(x, y);
    const terrain = this.getTerrain(x, y);
    return terrain !== TerrainType.Impassable;
  }

  isOccupied(x: number, y: number): boolean {
    const cell = this.getCell(x, y);
    return cell?.unit !== null;
  }

  getUnitAt(x: number, y: number): Unit | null {
    const cell = this.getCell(x, y);
    return cell?.unit ?? null;
  }

  // ============================================
  // Unit Position Management
  // ============================================

  placeUnit(unit: Unit, x: number, y: number): void {
    // Remove from old position if exists
    this.removeUnit(unit);

    // Place at new position
    const cell = this.getCell(x, y);
    if (cell) {
      cell.unit = unit;
      unit.gridX = x;
      unit.gridY = y;
    }
  }

  removeUnit(unit: Unit): void {
    const cell = this.getCell(unit.gridX, unit.gridY);
    if (cell && cell.unit === unit) {
      cell.unit = null;
    }
  }

  moveUnit(unit: Unit, toX: number, toY: number): void {
    this.placeUnit(unit, toX, toY);
  }

  // ============================================
  // Movement Range Calculation
  // ============================================

  /**
   * Calculate all tiles reachable within a given movement range
   * Uses flood fill / BFS to find reachable tiles
   */
  getMovementRange(
    startX: number,
    startY: number,
    moveRange: number,
    unit: Unit
  ): { x: number; y: number }[] {
    const reachable: { x: number; y: number }[] = [];
    const visited = new Map<string, number>(); // key -> remaining movement
    const queue: { x: number; y: number; remaining: number }[] = [];

    const key = (x: number, y: number) => `${x},${y}`;

    queue.push({ x: startX, y: startY, remaining: moveRange });
    visited.set(key(startX, startY), moveRange);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { x, y, remaining } = current;

      // Add to reachable if not the starting position
      if (x !== startX || y !== startY) {
        reachable.push({ x, y });
      }

      if (remaining <= 0) continue;

      // Check 4 adjacent tiles
      const neighbors = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ];

      for (const neighbor of neighbors) {
        const { x: nx, y: ny } = neighbor;

        if (!this.isValidPosition(nx, ny)) continue;
        if (!this.isWalkable(nx, ny, unit.flying)) continue;

        // Can move through allies and unconscious enemies, but not conscious enemies
        const occupant = this.getUnitAt(nx, ny);
        if (occupant && occupant !== unit) {
          // Block movement through conscious enemies only
          if (occupant.team !== unit.team && !occupant.isUnconscious) continue;
          // Can path through allies and unconscious enemies (but can't stop on them - handled in filter below)
        }

        const moveCost = this.getMoveCost(nx, ny, unit.flying);
        const newRemaining = remaining - moveCost;

        if (newRemaining < 0) continue;

        const nodeKey = key(nx, ny);
        const previousRemaining = visited.get(nodeKey);

        // Only continue if we found a better path
        if (previousRemaining === undefined || newRemaining > previousRemaining) {
          visited.set(nodeKey, newRemaining);
          queue.push({ x: nx, y: ny, remaining: newRemaining });
        }
      }
    }

    // Filter out tiles occupied by other units (can move through allies but not stop on them)
    return reachable.filter(({ x, y }) => !this.isOccupied(x, y));
  }

  /**
   * Get movement cost for a tile (for future terrain effects)
   */
  getMoveCost(x: number, y: number, flying?: boolean): number {
    // Flying units ignore terrain costs
    if (flying) return 1;
    const terrain = this.getTerrain(x, y);
    switch (terrain) {
      case TerrainType.Normal:
        return 1;
      case TerrainType.Difficult:
        return 2; // Difficult terrain costs 2 movement
      case TerrainType.Impassable:
        return Infinity;
      default:
        return 1;
    }
  }

  // ============================================
  // Pathfinding (A*)
  // ============================================

  /**
   * Find the shortest path from start to goal using A*
   * Returns array of positions (excluding start, including goal)
   */
  findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    unit: Unit
  ): { x: number; y: number }[] | null {
    if (!this.isValidPosition(goalX, goalY)) return null;
    if (!this.isWalkable(goalX, goalY, unit.flying)) return null;
    if (this.isOccupied(goalX, goalY)) return null;

    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;

    const heuristic = (x: number, y: number) =>
      Math.abs(x - goalX) + Math.abs(y - goalY);

    const startNode: PathNode = {
      x: startX,
      y: startY,
      g: 0,
      h: heuristic(startX, startY),
      f: heuristic(startX, startY),
      parent: null,
    };

    openSet.push(startNode);

    while (openSet.length > 0) {
      // Get node with lowest f score
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;

      // Goal reached
      if (current.x === goalX && current.y === goalY) {
        // Reconstruct path
        const path: { x: number; y: number }[] = [];
        let node: PathNode | null = current;
        while (node && node.parent) {
          path.unshift({ x: node.x, y: node.y });
          node = node.parent;
        }
        return path;
      }

      closedSet.add(key(current.x, current.y));

      // Check neighbors
      const neighbors = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
      ];

      for (const neighbor of neighbors) {
        const { x: nx, y: ny } = neighbor;

        if (!this.isValidPosition(nx, ny)) continue;
        if (!this.isWalkable(nx, ny, unit.flying)) continue;
        if (closedSet.has(key(nx, ny))) continue;

        // Can move through allies and unconscious enemies (matching getMovementRange logic)
        const occupant = this.getUnitAt(nx, ny);
        if (occupant && occupant !== unit) {
          // Block movement through conscious enemies only
          if (occupant.team !== unit.team && !occupant.isUnconscious) continue;
          // Can path through allies and unconscious enemies (but can't stop on them - goal check above ensures this)
        }

        const moveCost = this.getMoveCost(nx, ny, unit.flying);
        const tentativeG = current.g + moveCost;

        // Check if already in open set with better score
        const existingIndex = openSet.findIndex(n => n.x === nx && n.y === ny);
        if (existingIndex !== -1) {
          if (tentativeG >= openSet[existingIndex].g) continue;
          openSet.splice(existingIndex, 1);
        }

        const h = heuristic(nx, ny);
        const newNode: PathNode = {
          x: nx,
          y: ny,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        };

        openSet.push(newNode);
      }
    }

    // No path found
    return null;
  }

  // ============================================
  // Range and Distance Calculations
  // ============================================

  /**
   * Get Manhattan distance between two points
   */
  getDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Check if target is within range of attacker
   */
  isInRange(
    attackerX: number,
    attackerY: number,
    targetX: number,
    targetY: number,
    range: number
  ): boolean {
    return this.getDistance(attackerX, attackerY, targetX, targetY) <= range;
  }

  /**
   * Get all tiles within range (for ability targeting)
   */
  getTilesInRange(
    centerX: number,
    centerY: number,
    range: number
  ): { x: number; y: number }[] {
    const tiles: { x: number; y: number }[] = [];

    for (let y = centerY - range; y <= centerY + range; y++) {
      for (let x = centerX - range; x <= centerX + range; x++) {
        if (!this.isValidPosition(x, y)) continue;
        if (this.getDistance(centerX, centerY, x, y) <= range) {
          tiles.push({ x, y });
        }
      }
    }

    return tiles;
  }

  /**
   * Get all units within range
   */
  getUnitsInRange(
    centerX: number,
    centerY: number,
    range: number,
    units: Unit[]
  ): Unit[] {
    return units.filter(
      u => this.getDistance(centerX, centerY, u.gridX, u.gridY) <= range
    );
  }

  // ============================================
  // Coordinate Conversion
  // ============================================

  /**
   * Convert grid coordinates to pixel coordinates (center of tile)
   */
  gridToPixel(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
      y: gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
    };
  }

  /**
   * Convert pixel coordinates to grid coordinates
   */
  pixelToGrid(pixelX: number, pixelY: number): { x: number; y: number } {
    return {
      x: Math.floor(pixelX / GAME_CONFIG.TILE_SIZE),
      y: Math.floor(pixelY / GAME_CONFIG.TILE_SIZE),
    };
  }
}
