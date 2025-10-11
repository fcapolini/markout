({
  id: 0,
  name: 'page',
      children: [
        {
          id: 1,
          name: 'head',
          values: {
            y: {
              exp: function() { return 1; }
            }
          },
          children: []
        },
        {
          id: 2,
          name: 'body',
          values: {
            x: {
              exp: function() { return this.head.y; },
              deps: [function() { return this.head.$value('y'); }]
            }
          },
          children: []
        },
      ]
});