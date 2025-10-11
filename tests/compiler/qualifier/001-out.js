({
  id: 0,
  name: 'page',
      children: [
        {
          id: 1,
          name: 'head',
          children: []
        },
        {
          id: 2,
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
});