import * as vscode from "vscode";
import * as jsxInfo from "jsx-info";
import * as logger from "./logger";

export function activate(context: vscode.ExtensionContext) {
  const jsxInfoProvider = new JSXInfoProvider();
  const treeView = vscode.window.createTreeView("jsxInfo", {
    treeDataProvider: jsxInfoProvider,
    showCollapseAll: true,
  });
  async function cmdRun() {
    try {
      await jsxInfoProvider.run(treeView);
    } catch (err) {
      vscode.window.showErrorMessage(err.message);
      logger.fail(err.message);
    }
  }
  async function cmdRefresh() {
    try {
      await jsxInfoProvider.refresh(treeView);
    } catch (err) {
      vscode.window.showErrorMessage(err.message);
      logger.fail(err.message);
    }
  }
  async function cmdOpenFile(options: {
    filename: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }) {
    try {
      await openFile(options);
    } catch (err) {
      vscode.window.showErrorMessage(err.message);
      logger.fail(err.message);
    }
  }
  // Dispose the commands when the extension is deactivated
  context.subscriptions.push(
    vscode.commands.registerCommand("jsxInfo.run", cmdRun),
    vscode.commands.registerCommand("jsxInfo.refresh", cmdRefresh),
    // This command isn't exported in package.json because it's an internal
    // thing used be the tree view
    vscode.commands.registerCommand("jsxInfo._openFile", cmdOpenFile)
  );
  logger.info("JSX Info loaded");
}

function filterGaps<A>(items: (A | undefined)[]): A[] {
  return items.filter((a) => a !== undefined) as A[];
}

/** Open file to the given position */
async function openFile({
  filename,
  startLine,
  startColumn,
  endLine,
  endColumn,
}: {
  filename: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(filename);
  const editor = await vscode.window.showTextDocument(doc);
  const range = new vscode.Range(
    startLine - 1,
    startColumn,
    endLine - 1,
    endColumn
  );
  const type = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
  editor.revealRange(range, type);
  editor.selection = new vscode.Selection(range.start, range.end);
}

/** Sorted entries for an object, good for displaying objects in a UI */
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

/** Sort object descending by values */
function sortObjectValuesDesc<A>(dict: Record<string, A>): [string, A][] {
  return sortObject(dict, "desc", (_k, v) => v);
}

/** Sort object ascending by keys */
function sortObjectKeysAsc<A>(dict: Record<string, A>): [string, A][] {
  return sortObject(dict, "asc", (k, _v) => k);
}

/** Overall extension state */
type Mode =
  | { name: "empty" }
  | { name: "loading"; options: Options }
  | { name: "ok"; options: Options; result: jsxInfo.Analysis };

interface Options {
  dir: string;
  components: string[];
  report: string;
  prop?: string;
}

class JSXInfoProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _mode: Mode = { name: "empty" };

  itemRun = new TreeCommandRun();
  itemRefresh = new TreeCommandRefresh();
  itemLoading = new TreeLoading();

  async refresh(treeView: vscode.TreeView<TreeItem>) {
    if (this._mode.name === "loading") {
      return;
    }
    const options =
      this._mode.name === "empty"
        ? await this._getOptions()
        : this._mode.options;
    if (!options) {
      return;
    }
    await this._refresh(treeView, options);
  }

  async _refresh(
    treeView: vscode.TreeView<TreeItem>,
    options: Options
  ): Promise<void> {
    try {
      this._setMode({ name: "loading", options });
      treeView.reveal(this.itemLoading);
      const result = await jsxInfo.analyze({
        directory: options.dir,
        components: options.components,
        prop: options.prop,
      });
      this._setMode({ name: "ok", options, result });
      logger.info(`Analysis took ${result.elapsedTime} seconds`);
    } catch (err) {
      if (err instanceof Error) {
        vscode.window.showErrorMessage(err.message);
        this._setMode({ name: "empty" });
      } else {
        throw err;
      }
    }
  }

  private _setMode(mode: Mode) {
    this._mode = mode;
    this._onDidChangeTreeData.fire();
  }

  private _render() {
    if (this._mode.name === "empty") {
      return [this.itemRun];
    }
    if (this._mode.name === "loading") {
      return [this.itemLoading];
    }
    const { options, result } = this._mode;
    return [
      this.itemRun,
      this.itemRefresh,
      new TreeFolder(result.directory, [
        new TreeInfo(
          `${result.filenames.length} files in ${result.elapsedTime} seconds`
        ),
        new TreeInfo(
          `${result.componentTotal} components, ${result.componentUsageTotal} uses`
        ),
        new TreeInfo(new Date().toLocaleString()),
        Object.keys(result.errors).length > 0
          ? new TreeErrors(
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
          ? new TreeSuggestions(
              "Suggested Plugins",
              result.suggestedPlugins.map((plugin) => {
                return new TreeInfo(plugin);
              })
            )
          : undefined,
      ]),
      options.report === "Usage"
        ? new TreeFolder(
            "Usage Report",
            sortObjectValuesDesc(result.componentUsage).map(
              ([componentName, count]) => {
                return new TreeInfo(`${count}  <${componentName}>`);
              }
            )
          )
        : options.report === "Props"
        ? new TreeFolder(
            "Props Report",
            sortObject(
              result.propUsage,
              "desc",
              (k) => result.componentUsage[k]
            ).map(([componentName, propUsage]) => {
              const total = result.componentUsage[componentName];
              return new TreeComponent(
                `<${componentName}>  ${total}`,
                sortObjectValuesDesc(propUsage).map(([propName, count]) => {
                  const pct = ((count / total) * 100).toFixed(0);
                  return new TreeInfo(`${count}  ${propName}`, `(${pct}%)`);
                })
              );
            })
          )
        : new TreeFolder(
            "Lines Report",
            sortObjectKeysAsc(result.lineUsage).map(
              ([componentName, lineUsage]) => {
                return new TreeComponent(
                  `<${componentName}>`,
                  sortObjectKeysAsc(lineUsage).map(([propName, objects]) => {
                    return new TreeProp(
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
                  })
                );
              }
            )
          ),
    ];
  }

  async run(treeView: vscode.TreeView<TreeItem>): Promise<void> {
    if (this._mode.name === "loading") {
      return;
    }
    const options = await this._getOptions();
    if (!options) {
      return;
    }
    this._refresh(treeView, options);
  }

  private async _getOptions(): Promise<Options | undefined> {
    const [
      folder = await vscode.window.showWorkspaceFolderPick({
        ignoreFocusOut: true,
      }),
    ] = vscode.workspace.workspaceFolders || [];
    if (!folder) {
      return undefined;
    }
    if (folder.uri.scheme !== "file") {
      vscode.window.showErrorMessage(
        `JSX Info doesn't support files over ${folder.uri.scheme}`
      );
      return undefined;
    }
    const dir = folder.uri.fsPath;
    const componentsString = await vscode.window.showInputBox({
      prompt: "Which components?",
      placeHolder: "space separated, blank or * for every component",
      ignoreFocusOut: true,
    });
    if (componentsString === undefined) {
      return undefined;
    }
    const components =
      (componentsString || "*") === "*" ? [] : componentsString.split(/\s+/);
    const reportPick = await vscode.window.showQuickPick(
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
    if (reportPick === undefined) {
      return undefined;
    }
    const report = reportPick.label;
    let prop: string | undefined = undefined;
    if (report === "Lines") {
      const searchProp = await vscode.window.showInputBox({
        prompt: "Which prop?",
        placeHolder:
          "`id` or `variant=primary` or `!className` or `type!=text`",
        ignoreFocusOut: true,
      });
      if (searchProp === undefined || searchProp === "") {
        return undefined;
      }
      prop = searchProp;
    }
    return { components, dir, prop, report };
  }

  getTreeItem(element: TreeItem) {
    return element;
  }

  getParent(element: TreeItem) {
    return element.parent;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element) {
      return element.children;
    }
    return this._render();
  }
}

class TreeItem extends vscode.TreeItem {
  children: TreeItem[] = [];
  parent?: TreeItem;
}

class TreeFolder extends TreeItem {
  constructor(label: string, children: (TreeItem | undefined)[]) {
    super(label);
    if (children.length === 0) {
      this.children = [new TreeInfo("No results")];
    } else {
      this.children = filterGaps(children);
    }
    for (const kid of this.children) {
      kid.parent = this;
    }
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }

  iconPath = vscode.ThemeIcon.Folder;
}

class TreeComponent extends TreeFolder {
  iconPath = new vscode.ThemeIcon("symbol-class");
}

class TreeProp extends TreeFolder {
  iconPath = new vscode.ThemeIcon("symbol-field");
}

class TreeErrors extends TreeFolder {
  iconPath = new vscode.ThemeIcon("error");
}

class TreeSuggestions extends TreeFolder {
  iconPath = new vscode.ThemeIcon("info");
}

class TreeInfo extends TreeItem {
  constructor(label: string, description?: string) {
    super(label);
    this.description = description;
    if (description) {
      this.tooltip = `${label}  ${description}`;
    }
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
  }
}

class TreeLoading extends TreeInfo {
  constructor() {
    super("Loading...");
  }

  iconPath = new vscode.ThemeIcon("loading");
}

class TreeCommandRun extends TreeItem {
  constructor() {
    super("Run");
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = { title: "Run", command: "jsxInfo.run" };
  }

  iconPath = new vscode.ThemeIcon("play");
}

class TreeCommandRefresh extends TreeItem {
  constructor() {
    super("Refresh");
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.command = { title: "Refresh", command: "jsxInfo.refresh" };
  }

  iconPath = new vscode.ThemeIcon("sync");
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
      arguments: [{ filename, startLine, startColumn, endLine, endColumn }],
    };
  }
}
