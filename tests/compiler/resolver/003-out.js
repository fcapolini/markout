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
              name: 'style1',
              y: {
                exp: function() { return 1; }
              },
              children: []
            }
          ]
        },
        {
          id: 3,
          name: 'body',
          closed: true,
          children: [
            {
              id: 4,
              x: {
                exp: function() { return this.head.style1.y; },
                deps: [function() { return this.head.style1.$value('y'); }]
              },
              children: []
            }
          ]
        },
      ]
});