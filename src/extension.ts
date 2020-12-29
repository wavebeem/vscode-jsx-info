import * as vscode from "vscode";
import * as jsxInfo from "jsx-info";
import * as logger from "./logger";
import { start } from "repl";

logger.info("JSX Info loaded");

function assertNever(data: never): never {
  throw new Error("assertNever: " + data);
}

async function openFile(
  filename: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(filename);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(
      startLine,
      startColumn,
      endLine,
      endColumn
    );
  } catch (err) {
    vscode.window.showErrorMessage(err.message);
    logger.fail(err.message);
  }
}

function sortObject<A>(
  dict: Record<string, A>,
  direction: "asc" | "desc",
  getSortKey: (key: string, value: A) => string | A
): [string, A][] {
  const dir = direction === "asc" ? 1 : -1;
  const items: [string, A][] = [];
  for (const key of Object.keys(dict)) {
    items.push([key, dict[key]]);
  }
  items.sort((ra, rb) => {
    const a = getSortKey(...ra);
    const b = getSortKey(...rb);
    if (a < b) return dir * -1;
    if (a > b) return dir * 1;
    return 0;
  });
  return items;
}

function sortObjectValuesDesc<A>(dict: Record<string, A>): [string, A][] {
  return sortObject(dict, "desc", (_k, v) => v);
}

function sortObjectKeysAsc<A>(dict: Record<string, A>): [string, A][] {
  return sortObject(dict, "asc", (k, _v) => k);
}

export function activate(_context: vscode.ExtensionContext) {
  const jsxInfoProvider = new JSXInfoProvider();
  vscode.window.registerTreeDataProvider("jsxInfo", jsxInfoProvider);
  vscode.commands.registerCommand("jsxInfo.run", () => {
    jsxInfoProvider.run();
  });
  vscode.commands.registerCommand("jsxInfo.refresh", () => {
    jsxInfoProvider.refresh();
  });
  vscode.commands.registerCommand(
    "jsxInfo._openFile",
    (
      filename: string,
      startLine: number,
      startColumn: number,
      endLine: number,
      endColumn: number
    ) => {
      openFile(filename, startLine, startColumn, endLine, endColumn);
    }
  );
}

type Mode =
  | { name: "empty" }
  | { name: "loading" }
  | { name: "ok"; result: jsxInfo.Analysis };

class JSXInfoProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  mode: Mode = { name: "empty" };

  async refresh(): Promise<void> {
    logger.info("TODO: Refresh the data");
  }

  async run(): Promise<void> {
    try {
      this.mode = { name: "loading" };
      this._onDidChangeTreeData.fire();
      const [dir = await vscode.window.showWorkspaceFolderPick()] =
        vscode.workspace.workspaceFolders || [];
      if (!dir) {
        return;
      }
      if (dir.uri.scheme !== "file") {
        vscode.window.showErrorMessage(
          `JSX Info doesn't support files over ${dir.uri.scheme}`
        );
        return;
      }
      logger.info(dir);
      const result = await jsxInfo.analyze({
        directory: dir.uri.fsPath,
      });
      logger.info(result);
      this.mode = { name: "ok", result };
      this._onDidChangeTreeData.fire();
    } catch (err) {
      if (err instanceof Error) {
        vscode.window.showErrorMessage(err.message);
        this.mode = { name: "empty" };
        this._onDidChangeTreeData.fire();
      } else {
        throw err;
      }
    }
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element instanceof TreeItem) {
      return element.children;
    }
    switch (this.mode.name) {
      case "empty":
        return [new TreeCommand("Run", "jsxInfo.run", [])];
      case "loading":
        return [new TreeItem("Loading...")];
      case "ok": {
        const { result } = this.mode;
        const sep = "  \u{2013}  ";
        return [
          new TreeCommand("Run", "jsxInfo.run", []),
          new TreeCommand("Refresh", "jsxInfo.refresh", []),
          new TreeFolder(result.directory, [
            new TreeInfo(
              `Scanned ${result.filenames.length} files in ${result.elapsedTime} seconds`
            ),
            // new TreeInfo(`${result.filenames.length} files`),
            new TreeInfo(
              `Found ${result.componentTotal} components used ${result.componentUsageTotal} times`
            ),
            Object.keys(result.errors).length > 0
              ? new TreeFolder(
                  "Errors",
                  sortObjectKeysAsc(result.errors).map(([filename, obj]) => {
                    return new TreeOpenFile(
                      obj.message,
                      filename,
                      obj.loc.line,
                      obj.loc.column,
                      obj.loc.line,
                      obj.loc.column
                    );
                  })
                )
              : undefined,
            result.suggestedPlugins.length > 0
              ? new TreeFolder(
                  "Suggested Plugins",
                  result.suggestedPlugins.map((plugin) => {
                    return new TreeInfo(plugin);
                  })
                )
              : undefined,
          ]),
          // TODO: result.lineUsage
          new TreeFolder(
            "Prop Usage",
            sortObjectKeysAsc(result.propUsage).map(
              ([componentName, propUsage]) => {
                return new TreeFolder(
                  `<${componentName}>`,
                  sortObjectValuesDesc(propUsage).map(([propName, count]) => {
                    return new TreeInfo(`${count}${sep}${propName}`);
                  })
                );
              }
            )
          ),
          new TreeFolder(
            "Component Usage",
            sortObjectValuesDesc(result.componentUsage).map(
              ([componentName, count]) => {
                return new TreeInfo(`${count}${sep}<${componentName}>`);
              }
            )
          ),
        ];
      }
      default:
        assertNever(this.mode);
    }
  }
}

class TreeItem extends vscode.TreeItem {
  children: TreeItem[] = [];
}

class TreeFolder extends TreeItem {
  constructor(label: string, children: (TreeItem | undefined)[]) {
    super(label);
    this.children = children.filter((c) => c) as TreeItem[];
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }
}

class TreeInfo extends TreeItem {
  constructor(label: string, description?: string) {
    super(label);
    this.description = description;
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
  }
}

class TreeCommand extends TreeItem {
  constructor(label: string, command: string, args: any[]) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = { title: label, command, arguments: args };
  }
}

class TreeOpenFile extends TreeItem {
  constructor(
    label: string,
    filename: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
  ) {
    super(filename);
    this.description = `${startLine}:${startColumn}`;
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = {
      title: label,
      command: "jsxInfo._openFile",
      arguments: [filename, startLine, startColumn, endLine, endColumn],
    };
  }
}
