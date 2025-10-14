({
  id: 0,
  name: 'page',
  children: [
    {
      id: 1,
      name: 'head',
      children: [
        {
          id: 2,
          name: 'theme',
          values: {
            mode: {
              exp: function() { return "light"; }
            }
          },
          children: []
        }
      ]
    },
    {
      id: 3,
      name: 'body',
      children: [
        {
          id: 4,
          values: {
            x: {
              exp: function() { return this.theme.mode; },
              deps: [function() { return this.theme.$value('mode'); }]
            }
          },
          children: []
        }
      ]
    }
  ]
});