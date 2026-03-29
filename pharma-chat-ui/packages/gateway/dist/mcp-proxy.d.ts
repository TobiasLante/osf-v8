import type { IRouter } from 'express';
export declare const mcpRouter: IRouter;
export declare function mcpListTools(): Promise<any>;
export declare function mcpCallTool(name: string, args: Record<string, any>): Promise<any>;
