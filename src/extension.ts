import * as vscode from "vscode";
import * as jsxInfo from "jsx-info";
import * as logger from "./logger";

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
    const range = new vscode.Range(
      startLine - 1,
      startColumn,
      endLine - 1,
      endColumn
    );
    editor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    editor.selection = new vscode.Selection(
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character
    );
  } catch (err) {
    vscode.window.showErrorMessage(err.message);
    logger.fail(err.message);
  }
}

function sortObject<A>(
  dict: Record<string, A>,
  direction: "asc" | "desc",
  getSortKey: (key: string, value: A) => any
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

  searchDir?: string;
  searchComponents?: string;
  searchReport?: string;
  searchProp?: string;

  mode: Mode = { name: "empty" };

  async refresh(): Promise<void> {
    try {
      this.mode = { name: "loading" };
      this._onDidChangeTreeData.fire();
      const comp = this.searchComponents || "";
      const result = await jsxInfo.analyze({
        directory: this.searchDir,
        components: comp === "" || comp === "*" ? [] : comp.split(/\s+/),
        prop: this.searchProp,
      });
      this.mode = { name: "ok", result };
      this._onDidChangeTreeData.fire();
      logger.info(result);
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

  async run(): Promise<void> {
    const ok = await this._getOptions();
    if (!ok) {
      return;
    }
    this.refresh();
  }

  private async _getOptions(): Promise<boolean> {
    const [
      dir = await vscode.window.showWorkspaceFolderPick({
        ignoreFocusOut: true,
      }),
    ] = vscode.workspace.workspaceFolders || [];
    if (!dir) {
      return false;
    }
    if (dir.uri.scheme !== "file") {
      vscode.window.showErrorMessage(
        `JSX Info doesn't support files over ${dir.uri.scheme}`
      );
      return false;
    }
    this.searchDir = dir.uri.fsPath;
    this.searchComponents = await vscode.window.showInputBox({
      prompt: "Which components?",
      placeHolder: "space separated, blank or * for every component",
      ignoreFocusOut: true,
    });
    if (this.searchComponents === undefined) {
      return false;
    }
    const report = await vscode.window.showQuickPick(
      [
        {
          label: "Usage",
          description: "Total component usage",
        },
        {
          label: "Props",
          description: "Total prop usage",
        },
        {
          label: "Lines",
          description: "Show lines where certain props are used",
        },
      ],
      {
        ignoreFocusOut: true,
      }
    );
    if (report === undefined) {
      return false;
    }
    this.searchReport = report.label;
    if (this.searchReport === "Lines") {
      this.searchProp = await vscode.window.showInputBox({
        prompt: "Which prop?",
        placeHolder:
          "`id` or `variant=primary` or `!className` or `type!=text`",
        ignoreFocusOut: true,
      });
      if (this.searchProp === undefined || this.searchProp === "") {
        return false;
      }
    }
    return true;
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
        return [new TreeInfo("Scanning...")];
      case "ok": {
        const { result } = this.mode;
        const sep = "  \u{00b7}  ";
        return [
          new TreeCommand("Run", "jsxInfo.run", []),
          new TreeCommand("Refresh", "jsxInfo.refresh", []),
          new TreeFolder(result.directory, [
            new TreeInfo(
              `${result.filenames.length} files in ${result.elapsedTime} seconds`
            ),
            new TreeInfo(
              `${result.componentTotal} components, ${result.componentUsageTotal} uses`
            ),
            Object.keys(result.errors).length > 0
              ? new TreeFolder(
                  "Errors",
                  sortObjectKeysAsc(result.errors).map(([filename, obj]) => {
                    return new TreeOpenFile(
                      filename,
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
          this.searchReport === "Usage"
            ? new TreeFolder(
                "Usage Report",
                sortObjectValuesDesc(result.componentUsage).map(
                  ([componentName, count]) => {
                    return new TreeInfo(`${count}${sep}<${componentName}>`);
                  }
                )
              )
            : this.searchReport === "Props"
            ? new TreeFolder(
                "Props Report",
                sortObject(
                  result.propUsage,
                  "desc",
                  (k) => result.componentUsage[k]
                ).map(([componentName, propUsage]) => {
                  const total = result.componentUsage[componentName];
                  return new TreeFolder(
                    `<${componentName}>${sep}${total}`,
                    sortObjectValuesDesc(propUsage).map(([propName, count]) => {
                      const pct = ((count / total) * 100).toFixed(0);
                      return new TreeInfo(
                        `${count}${sep}${propName}${sep}${pct}%`
                      );
                    })
                  );
                })
              )
            : new TreeFolder(
                "Lines Report",
                sortObjectKeysAsc(result.lineUsage).map(
                  ([componentName, lineUsage]) => {
                    return new TreeFolder(
                      componentName,
                      sortObjectKeysAsc(lineUsage).map(
                        ([propName, objects]) => {
                          return new TreeFolder(
                            propName,
                            objects.map((obj) => {
                              return new TreeOpenFile(
                                obj.propCode,
                                obj.filename,
                                obj.startLoc.line,
                                obj.startLoc.column,
                                obj.endLoc.line,
                                obj.endLoc.column
                              );
                            })
                          );
                        }
                      )
                    );
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
    if (children.length === 0) {
      this.children = [new TreeInfo("No results")];
    } else {
      this.children = children.filter((c) => c) as TreeItem[];
    }
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }
}

class TreeInfo extends TreeItem {
  constructor(label: string) {
    super(label);
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
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = {
      title: label,
      command: "jsxInfo._openFile",
      arguments: [filename, startLine, startColumn, endLine, endColumn],
    };
  }
}
