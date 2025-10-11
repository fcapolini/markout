({
  __id: 0,
  __children: [
    {
      __id: 1,
      __name: 'page',
      __children: [
        {
          __id: 2,
          __name: 'head',
          __children: [
            {
              __id: 3,
              __name: 'style1',
              y: {
                e: function() { return 1; }
              },
              __children: []
            }
          ]
        },
        {
          __id: 4,
          __name: 'body',
          __children: [
            {
              __id: 5,
              x: {
                e: function() { return this.head.style1.y; },
                r: [function() { return this.head.style1.$value('y'); }]
              },
              __children: []
            }
          ]
        },
      ]
    }
  ]
})
