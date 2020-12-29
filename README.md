# JSX Info for VS Code

## What is it?

JSX Info is a VS Code extension for [jsx-info](https://www.npmjs.com/package/jsx-info). It can analyze your code base and display reports about how JSX is used.

- **How many times is each component used?**

  This is useful if you're looking to get rid of a component, but want to see how widely used it is first.

- **How many times is a prop used?**

  This is useful if you want to remove a prop from a component, but want to see how widely used it is first.

- **Where is this prop used?**

  You can search by prop name and value, and click through a list in the sidebar that will open the files and highlight the code where the prop is.

  - Find by prop: `disabled`
  - Find by prop with value: `id=foo`
  - Find by prop with value not equal: `kind!=primary`
  - Find by prop not existing: `!type`

## Installation

Once installed, JSX Info will show up in your Explorer sidebar.

From there, click the "JSX Info" header to expand the view.

Click "Run" to get started.
