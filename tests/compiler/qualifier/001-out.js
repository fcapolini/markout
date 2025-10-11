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
          children: []
        },
        {
          id: 3,
          name: 'body',
          values: {
            x: {
              exp: function() { return this.y; },
              deps: [
                function() { return this.$value('y'); },
              ]
            },
            y: {
              exp: function() { return 1; }
            }
          },
          children: []
        },
      ]
    }
  ]
})
