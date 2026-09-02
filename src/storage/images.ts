import fs from 'node:fs';
import { resolveUserPath } from './paths.js';

export function resolveImagePaths(imagePaths: string[] | undefined): string[] {
  const resolvedPaths: string[] = [];

  for (const rawValue of imagePaths || []) {
    for (const rawPath of rawValue.split(',')) {
      const imagePath = rawPath.trim();
      if (!imagePath) continue;

      const resolvedPath = resolveUserPath(imagePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Image file not found: ${resolvedPath}`);
      }
      if (!fs.statSync(resolvedPath).isFile()) {
        throw new Error(`Image path is not a file: ${resolvedPath}`);
      }
      resolvedPaths.push(resolvedPath);
    }
  }

  return resolvedPaths;
}
