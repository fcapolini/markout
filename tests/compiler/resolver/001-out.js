({
  id: 0,
  children: [
    {
      id: 1,
      name: 'page',
      children: [
        {
          id: 2,
          name: 'head',
          values: {
            y: {
              exp: function() { return 1; }
            }
          },
          children: []
        },
        {
          id: 3,
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
    }
  ]
})
